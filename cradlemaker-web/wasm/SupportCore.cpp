#include "SupportCore.hpp"
#include "OrcaSupportBridge.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <limits>
#include <numeric>
#include <sstream>
#include <string>
#include <vector>

namespace Cradlemaker::SupportCore {
namespace {

constexpr double kPi = 3.14159265358979323846;

struct Vec3 {
    double x = 0.0;
    double y = 0.0;
    double z = 0.0;
};

struct MeshStats {
    std::size_t vertex_values = 0;
    std::size_t vertex_count = 0;
    std::size_t triangle_count = 0;
    std::vector<Vec3> vertices;
    double min_x = std::numeric_limits<double>::max();
    double min_y = std::numeric_limits<double>::max();
    double min_z = std::numeric_limits<double>::max();
    double max_x = std::numeric_limits<double>::lowest();
    double max_y = std::numeric_limits<double>::lowest();
    double max_z = std::numeric_limits<double>::lowest();

    bool has_bounds() const { return vertex_values >= 3; }
};

struct SupportMesh {
    std::vector<Vec3> vertices;
    std::vector<std::array<int, 3>> triangles;
};

struct CoverageCell {
    Vec3 center;
    bool supported = false;
};

struct SupportSettings {
    bool enable_support = true;
    bool base_enabled = false;
    bool interface_enabled = false;
    bool foam_gap_enabled = false;
    bool remove_small_overhangs = true;
    bool tree_mode = false;
    bool requested_orca_tree_mode = false;
    double threshold_angle_deg = 30.0;
    double top_z_distance_mm = 0.2;
    double xy_distance_mm = 0.35;
    double edge_clearance_mm = 0.0;
    double contact_cell_size_mm = 0.8;
    double manual_contact_radius_mm = 3.0;
    double tree_branch_distance_mm = 10.0;
    double tree_tip_diameter_mm = 2.0;
    double tree_branch_diameter_mm = 6.0;
    double tree_branch_angle_deg = 45.0;
    int interface_top_layers = 0;
    double interface_layer_height_mm = 0.2;
    double foam_gap_z_mm = 0.0;
    double foam_gap_xy_mm = 0.0;
    double base_margin_mm = 5.0;
    double base_thickness_mm = 2.0;

    double interface_thickness_mm() const { return double(std::max(0, interface_top_layers)) * interface_layer_height_mm; }
    double effective_top_z_distance_mm() const { return top_z_distance_mm + (foam_gap_enabled ? foam_gap_z_mm : 0.0); }
    double effective_foam_gap_xy_mm() const { return foam_gap_enabled ? foam_gap_xy_mm : 0.0; }
};

struct ContactGrid {
    double origin_x = 0.0;
    double origin_y = 0.0;
    double cell_size = 2.5;
    double bottom_z = 0.0;
    int cols = 0;
    int rows = 0;
    std::vector<double> top_z;
    std::vector<double> model_ceiling_z;
    std::vector<double> lower_envelope_z;

    int index(const int ix, const int iy) const { return iy * cols + ix; }

    bool inside(const int ix, const int iy) const
    {
        return ix >= 0 && iy >= 0 && ix < cols && iy < rows;
    }

    bool occupied(const int ix, const int iy) const
    {
        return inside(ix, iy) && top_z[index(ix, iy)] > bottom_z + 0.05;
    }

    double top(const int ix, const int iy) const
    {
        return occupied(ix, iy) ? top_z[index(ix, iy)] : bottom_z;
    }

    bool has_model_ceiling(const int ix, const int iy) const
    {
        return inside(ix, iy) && model_ceiling_z[index(ix, iy)] < std::numeric_limits<double>::max() * 0.5;
    }

    double model_ceiling(const int ix, const int iy) const
    {
        return has_model_ceiling(ix, iy) ? model_ceiling_z[index(ix, iy)] : std::numeric_limits<double>::max();
    }
};

struct SupportGenerationStats {
    std::size_t overhang_facets = 0;
    std::size_t envelope_cells = 0;
    std::size_t pruned_sparse_cells = 0;
    std::size_t pruned_small_island_cells = 0;
    std::size_t closed_gap_cells = 0;
    std::size_t contact_cells = 0;
    std::size_t base_cells = 0;
    std::size_t interface_cells = 0;
    std::size_t edge_clearance_removed_cells = 0;
    std::size_t foam_gap_removed_cells = 0;
    std::size_t manual_points = 0;
    std::size_t tree_branches = 0;
};

struct CoverageSamples {
    std::vector<CoverageCell> cells;
    std::size_t supported_cells = 0;
    std::size_t unsupported_cells = 0;
};

struct QaStats {
    std::size_t downward_cells = 0;
    std::size_t supported_downward_cells = 0;
    std::size_t unsupported_downward_cells = 0;
    double supported_downward_percent = 0.0;
    std::size_t intersection_cells = 0;
    double max_penetration_mm = 0.0;
    std::size_t clearance_violation_cells = 0;
    double max_clearance_violation_mm = 0.0;
};

bool parse_numeric_array_after_key(const std::string& json, const std::string& key, MeshStats& stats)
{
    const std::string quoted_key = "\"" + key + "\"";
    const std::size_t key_pos = json.find(quoted_key);
    if (key_pos == std::string::npos)
        return false;

    const std::size_t array_pos = json.find('[', key_pos + quoted_key.size());
    if (array_pos == std::string::npos)
        return false;

    int depth = 0;
    bool in_string = false;
    bool escaped = false;
    Vec3 current_vertex;

    for (std::size_t index = array_pos; index < json.size(); ++index) {
        const char c = json[index];

        if (in_string) {
            if (escaped) {
                escaped = false;
            } else if (c == '\\') {
                escaped = true;
            } else if (c == '"') {
                in_string = false;
            }
            continue;
        }

        if (c == '"') {
            in_string = true;
            continue;
        }

        if (c == '[') {
            ++depth;
            continue;
        }

        if (c == ']') {
            if (depth == 1) {
                stats.vertex_count = stats.vertex_values / 3;
                stats.triangle_count = stats.vertex_count / 3;
                return true;
            }
            --depth;
            continue;
        }

        if (depth != 1)
            continue;

        const bool number_start = std::isdigit(static_cast<unsigned char>(c)) || c == '-' || c == '+';
        if (!number_start)
            continue;

        char* end = nullptr;
        const double value = std::strtod(json.c_str() + index, &end);
        if (end == json.c_str() + index)
            continue;

        const std::size_t axis = stats.vertex_values % 3;
        if (axis == 0) {
            current_vertex.x = value;
            stats.min_x = std::min(stats.min_x, value);
            stats.max_x = std::max(stats.max_x, value);
        } else if (axis == 1) {
            current_vertex.y = value;
            stats.min_y = std::min(stats.min_y, value);
            stats.max_y = std::max(stats.max_y, value);
        } else {
            current_vertex.z = value;
            stats.min_z = std::min(stats.min_z, value);
            stats.max_z = std::max(stats.max_z, value);
            stats.vertices.push_back(current_vertex);
        }

        ++stats.vertex_values;
        index = static_cast<std::size_t>(end - json.c_str() - 1);
    }

    return false;
}

std::size_t read_unsigned_field(const std::string& json, const std::string& key)
{
    const std::string quoted_key = "\"" + key + "\"";
    const std::size_t key_pos = json.find(quoted_key);
    if (key_pos == std::string::npos)
        return 0;

    const std::size_t colon_pos = json.find(':', key_pos + quoted_key.size());
    if (colon_pos == std::string::npos)
        return 0;

    std::size_t number_pos = colon_pos + 1;
    while (number_pos < json.size() && std::isspace(static_cast<unsigned char>(json[number_pos])))
        ++number_pos;

    std::size_t value = 0;
    bool found_digit = false;
    while (number_pos < json.size() && std::isdigit(static_cast<unsigned char>(json[number_pos]))) {
        found_digit = true;
        value = value * 10 + static_cast<std::size_t>(json[number_pos] - '0');
        ++number_pos;
    }

    return found_digit ? value : 0;
}

double read_number_field(const std::string& json, const std::string& key, const double fallback)
{
    const std::string quoted_key = "\"" + key + "\"";
    const std::size_t key_pos = json.find(quoted_key);
    if (key_pos == std::string::npos)
        return fallback;

    const std::size_t colon_pos = json.find(':', key_pos + quoted_key.size());
    if (colon_pos == std::string::npos)
        return fallback;

    std::size_t number_pos = colon_pos + 1;
    while (number_pos < json.size() && std::isspace(static_cast<unsigned char>(json[number_pos])))
        ++number_pos;

    char* end = nullptr;
    const double value = std::strtod(json.c_str() + number_pos, &end);
    return end == json.c_str() + number_pos ? fallback : value;
}

bool read_bool_field(const std::string& json, const std::string& key, const bool fallback)
{
    const std::string quoted_key = "\"" + key + "\"";
    const std::size_t key_pos = json.find(quoted_key);
    if (key_pos == std::string::npos)
        return fallback;

    const std::size_t colon_pos = json.find(':', key_pos + quoted_key.size());
    if (colon_pos == std::string::npos)
        return fallback;

    std::size_t value_pos = colon_pos + 1;
    while (value_pos < json.size() && std::isspace(static_cast<unsigned char>(json[value_pos])))
        ++value_pos;

    if (json.compare(value_pos, 4, "true") == 0)
        return true;
    if (json.compare(value_pos, 5, "false") == 0)
        return false;
    return fallback;
}

std::string read_string_field(const std::string& json, const std::string& key, const std::string& fallback = {})
{
    const std::string quoted_key = "\"" + key + "\"";
    const std::size_t key_pos = json.find(quoted_key);
    if (key_pos == std::string::npos)
        return fallback;

    const std::size_t colon_pos = json.find(':', key_pos + quoted_key.size());
    if (colon_pos == std::string::npos)
        return fallback;

    std::size_t value_pos = colon_pos + 1;
    while (value_pos < json.size() && std::isspace(static_cast<unsigned char>(json[value_pos])))
        ++value_pos;

    if (value_pos >= json.size() || json[value_pos] != '"')
        return fallback;

    std::string value;
    bool escaped = false;
    for (std::size_t index = value_pos + 1; index < json.size(); ++index) {
        const char c = json[index];
        if (escaped) {
            value.push_back(c);
            escaped = false;
            continue;
        }
        if (c == '\\') {
            escaped = true;
            continue;
        }
        if (c == '"')
            return value;
        value.push_back(c);
    }

    return fallback;
}

bool read_vec3_array_at(const std::string& json, const std::size_t array_pos, Vec3& out)
{
    if (array_pos == std::string::npos || array_pos >= json.size() || json[array_pos] != '[')
        return false;

    std::array<double, 3> values { 0.0, 0.0, 0.0 };
    std::size_t value_count = 0;
    for (std::size_t index = array_pos + 1; index < json.size() && value_count < values.size(); ++index) {
        const char c = json[index];
        if (c == ']')
            break;

        const bool number_start = std::isdigit(static_cast<unsigned char>(c)) || c == '-' || c == '+';
        if (!number_start)
            continue;

        char* end = nullptr;
        const double value = std::strtod(json.c_str() + index, &end);
        if (end == json.c_str() + index)
            continue;

        values[value_count++] = value;
        index = static_cast<std::size_t>(end - json.c_str() - 1);
    }

    if (value_count != values.size())
        return false;

    out = { values[0], values[1], values[2] };
    return true;
}

std::vector<Vec3> read_manual_support_points(const std::string& json)
{
    std::vector<Vec3> points;
    const std::string point_key = "\"point\"";
    std::size_t search_pos = 0;

    while (true) {
        const std::size_t key_pos = json.find(point_key, search_pos);
        if (key_pos == std::string::npos)
            break;

        const std::size_t array_pos = json.find('[', key_pos + point_key.size());
        Vec3 point;
        if (read_vec3_array_at(json, array_pos, point))
            points.push_back(point);

        search_pos = key_pos + point_key.size();
    }

    return points;
}

bool contains_json_string(const std::string& json, const std::string& value)
{
    return json.find("\"" + value + "\"") != std::string::npos;
}

SupportSettings read_support_settings(const std::string& json)
{
    SupportSettings settings;
    settings.enable_support = read_bool_field(json, "enable_support", settings.enable_support);
    settings.base_enabled = read_bool_field(json, "base_enabled", settings.base_enabled);
    settings.interface_enabled = read_bool_field(json, "support_interface_enabled", settings.interface_enabled);
    settings.foam_gap_enabled = read_bool_field(json, "foam_gap_enabled", settings.foam_gap_enabled);
    settings.remove_small_overhangs = read_bool_field(json, "support_remove_small_overhang", settings.remove_small_overhangs);
    const std::string support_type = read_string_field(json, "support_type");
    const std::string support_style = read_string_field(json, "support_style");
    settings.requested_orca_tree_mode = support_type.find("tree") != std::string::npos ||
        support_type.find("hybrid") != std::string::npos ||
        support_style.find("tree") != std::string::npos ||
        support_style.find("organic") != std::string::npos;
    settings.tree_mode = false;
    settings.threshold_angle_deg = read_number_field(json, "support_threshold_angle", settings.threshold_angle_deg);
    settings.top_z_distance_mm = read_number_field(json, "support_top_z_distance", settings.top_z_distance_mm);
    settings.xy_distance_mm = read_number_field(json, "support_object_xy_distance", settings.xy_distance_mm);
    settings.edge_clearance_mm = read_number_field(json, "support_edge_clearance_mm", settings.edge_clearance_mm);
    settings.contact_cell_size_mm = read_number_field(json, "support_base_pattern_spacing", settings.contact_cell_size_mm);
    settings.manual_contact_radius_mm = std::max(
        read_number_field(json, "tree_support_tip_diameter", 0.0) * 2.0,
        settings.contact_cell_size_mm);
    settings.tree_branch_distance_mm = read_number_field(json, "tree_support_branch_distance", settings.tree_branch_distance_mm);
    settings.tree_tip_diameter_mm = read_number_field(json, "tree_support_tip_diameter", settings.tree_tip_diameter_mm);
    settings.tree_branch_diameter_mm = read_number_field(json, "tree_support_branch_diameter", settings.tree_branch_diameter_mm);
    settings.tree_branch_angle_deg = read_number_field(json, "tree_support_branch_angle", settings.tree_branch_angle_deg);
    settings.interface_top_layers = int(read_number_field(json, "support_interface_top_layers", settings.interface_top_layers));
    settings.foam_gap_z_mm = read_number_field(json, "foam_gap_z_mm", settings.foam_gap_z_mm);
    settings.foam_gap_xy_mm = read_number_field(json, "foam_gap_xy_mm", settings.foam_gap_xy_mm);
    settings.base_margin_mm = read_number_field(json, "base_margin_mm", settings.base_margin_mm);
    settings.base_thickness_mm = read_number_field(json, "base_thickness_mm", settings.base_thickness_mm);
    settings.threshold_angle_deg = std::clamp(settings.threshold_angle_deg, 0.0, 89.0);
    settings.top_z_distance_mm = std::max(0.0, settings.top_z_distance_mm);
    settings.xy_distance_mm = std::max(0.0, settings.xy_distance_mm);
    settings.edge_clearance_mm = std::clamp(settings.edge_clearance_mm, 0.0, 25.0);
    settings.contact_cell_size_mm = std::clamp(settings.contact_cell_size_mm, 0.6, 8.0);
    settings.manual_contact_radius_mm = std::clamp(settings.manual_contact_radius_mm, settings.contact_cell_size_mm, 25.0);
    settings.tree_branch_distance_mm = std::clamp(settings.tree_branch_distance_mm, settings.contact_cell_size_mm * 2.0, 40.0);
    settings.tree_tip_diameter_mm = std::clamp(settings.tree_tip_diameter_mm, 0.4, 12.0);
    settings.tree_branch_diameter_mm = std::clamp(settings.tree_branch_diameter_mm, settings.tree_tip_diameter_mm, 30.0);
    settings.tree_branch_angle_deg = std::clamp(settings.tree_branch_angle_deg, 5.0, 85.0);
    settings.interface_top_layers = std::clamp(settings.interface_top_layers, 0, 10);
    if (!settings.interface_enabled)
        settings.interface_top_layers = 0;
    settings.foam_gap_z_mm = settings.foam_gap_enabled ? std::clamp(settings.foam_gap_z_mm, 0.0, 25.0) : 0.0;
    settings.foam_gap_xy_mm = settings.foam_gap_enabled ? std::clamp(settings.foam_gap_xy_mm, 0.0, 25.0) : 0.0;
    settings.base_margin_mm = std::max(0.0, settings.base_margin_mm);
    settings.base_thickness_mm = std::max(0.0, settings.base_thickness_mm);
    return settings;
}

Vec3 subtract(const Vec3& lhs, const Vec3& rhs)
{
    return { lhs.x - rhs.x, lhs.y - rhs.y, lhs.z - rhs.z };
}

Vec3 cross(const Vec3& lhs, const Vec3& rhs)
{
    return {
        lhs.y * rhs.z - lhs.z * rhs.y,
        lhs.z * rhs.x - lhs.x * rhs.z,
        lhs.x * rhs.y - lhs.y * rhs.x
    };
}

double length(const Vec3& value)
{
    return std::sqrt(value.x * value.x + value.y * value.y + value.z * value.z);
}

int add_vertex(SupportMesh& mesh, const Vec3& vertex)
{
    mesh.vertices.push_back(vertex);
    return int(mesh.vertices.size() - 1);
}

void add_triangle(SupportMesh& mesh, const Vec3& a, const Vec3& b, const Vec3& c)
{
    const int ia = add_vertex(mesh, a);
    const int ib = add_vertex(mesh, b);
    const int ic = add_vertex(mesh, c);
    mesh.triangles.push_back({ ia, ib, ic });
}

void add_quad(SupportMesh& mesh, const Vec3& a, const Vec3& b, const Vec3& c, const Vec3& d)
{
    add_triangle(mesh, a, b, c);
    add_triangle(mesh, a, c, d);
}

double triangle_area_2d(const Vec3& a, const Vec3& b, const Vec3& c)
{
    return std::abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

double point_segment_distance_xy(const Vec3& point, const Vec3& a, const Vec3& b)
{
    const double dx = b.x - a.x;
    const double dy = b.y - a.y;
    const double len_sq = dx * dx + dy * dy;
    if (len_sq <= 1e-12)
        return std::hypot(point.x - a.x, point.y - a.y);

    const double t = std::clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / len_sq, 0.0, 1.0);
    const double px = a.x + t * dx;
    const double py = a.y + t * dy;
    return std::hypot(point.x - px, point.y - py);
}

bool point_in_triangle_xy(const Vec3& point, const Vec3& a, const Vec3& b, const Vec3& c);

bool point_near_triangle_xy(const Vec3& point, const Vec3& a, const Vec3& b, const Vec3& c, const double distance)
{
    return point_in_triangle_xy(point, a, b, c) ||
        point_segment_distance_xy(point, a, b) <= distance ||
        point_segment_distance_xy(point, b, c) <= distance ||
        point_segment_distance_xy(point, c, a) <= distance;
}

bool point_in_triangle_xy(const Vec3& point, const Vec3& a, const Vec3& b, const Vec3& c)
{
    const double total_area = triangle_area_2d(a, b, c);
    if (total_area <= 1e-9)
        return false;

    const double a0 = triangle_area_2d(point, b, c);
    const double a1 = triangle_area_2d(a, point, c);
    const double a2 = triangle_area_2d(a, b, point);
    return std::abs((a0 + a1 + a2) - total_area) <= std::max(1e-6, total_area * 1e-5);
}

double interpolate_triangle_z_xy(const Vec3& point, const Vec3& a, const Vec3& b, const Vec3& c)
{
    const double denom = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (std::abs(denom) <= 1e-12)
        return std::min({ a.z, b.z, c.z });

    const double wa = ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y)) / denom;
    const double wb = ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y)) / denom;
    const double wc = 1.0 - wa - wb;
    return wa * a.z + wb * b.z + wc * c.z;
}

bool sample_cell_triangle_z(const ContactGrid& grid, const int ix, const int iy, const Vec3& a, const Vec3& b, const Vec3& c, double& sampled_z)
{
    const double cx = grid.origin_x + (double(ix) + 0.5) * grid.cell_size;
    const double cy = grid.origin_y + (double(iy) + 0.5) * grid.cell_size;
    const double half_cell = grid.cell_size * 0.5;
    const double quarter_cell = grid.cell_size * 0.25;
    const std::array<Vec3, 9> samples { {
        { cx, cy, 0.0 },
        { cx - quarter_cell, cy - quarter_cell, 0.0 },
        { cx + quarter_cell, cy - quarter_cell, 0.0 },
        { cx + quarter_cell, cy + quarter_cell, 0.0 },
        { cx - quarter_cell, cy + quarter_cell, 0.0 },
        { cx - half_cell, cy, 0.0 },
        { cx + half_cell, cy, 0.0 },
        { cx, cy - half_cell, 0.0 },
        { cx, cy + half_cell, 0.0 },
    } };

    bool sampled_triangle = false;
    sampled_z = std::numeric_limits<double>::max();
    for (const Vec3& sample : samples) {
        if (!point_in_triangle_xy(sample, a, b, c))
            continue;

        sampled_triangle = true;
        sampled_z = std::min(sampled_z, interpolate_triangle_z_xy(sample, a, b, c));
    }

    if (sampled_triangle)
        return true;

    const Vec3 centroid { (a.x + b.x + c.x) / 3.0, (a.y + b.y + c.y) / 3.0, 0.0 };
    if (centroid.x >= cx - half_cell && centroid.x <= cx + half_cell && centroid.y >= cy - half_cell && centroid.y <= cy + half_cell) {
        sampled_z = interpolate_triangle_z_xy(centroid, a, b, c);
        return true;
    }

    return false;
}

ContactGrid make_contact_grid(const MeshStats& mesh_stats, const SupportSettings& settings)
{
    const double bounds_margin = settings.xy_distance_mm + settings.base_margin_mm + settings.contact_cell_size_mm;
    const double min_x = mesh_stats.min_x - bounds_margin;
    const double min_y = mesh_stats.min_y - bounds_margin;
    const double max_x = mesh_stats.max_x + bounds_margin;
    const double max_y = mesh_stats.max_y + bounds_margin;
    double cell_size = settings.contact_cell_size_mm;
    int cols = std::max(1, int(std::ceil((max_x - min_x) / cell_size)));
    int rows = std::max(1, int(std::ceil((max_y - min_y) / cell_size)));

    constexpr int max_cells = 360000;
    if (cols * rows > max_cells) {
        const double area = std::max(1.0, (max_x - min_x) * (max_y - min_y));
        cell_size = std::sqrt(area / max_cells);
        cols = std::max(1, int(std::ceil((max_x - min_x) / cell_size)));
        rows = std::max(1, int(std::ceil((max_y - min_y) / cell_size)));
    }

    ContactGrid grid;
    grid.origin_x = min_x;
    grid.origin_y = min_y;
    grid.cell_size = cell_size;
    grid.bottom_z = 0.0;
    grid.cols = cols;
    grid.rows = rows;
    grid.top_z.assign(std::size_t(cols * rows), grid.bottom_z);
    grid.model_ceiling_z.assign(std::size_t(cols * rows), std::numeric_limits<double>::max());
    grid.lower_envelope_z.assign(std::size_t(cols * rows), std::numeric_limits<double>::max());
    return grid;
}

void mark_model_ceiling_cell(ContactGrid& grid, const int ix, const int iy, const double ceiling_z)
{
    if (!grid.inside(ix, iy) || ceiling_z <= grid.bottom_z + 0.05)
        return;

    double& cell_ceiling = grid.model_ceiling_z[grid.index(ix, iy)];
    cell_ceiling = std::min(cell_ceiling, ceiling_z);
}

void populate_model_collision_ceiling(ContactGrid& grid, const MeshStats& mesh_stats, const SupportSettings& settings)
{
    for (std::size_t vertex_index = 0; vertex_index + 2 < mesh_stats.vertices.size(); vertex_index += 3) {
        const Vec3 a = mesh_stats.vertices[vertex_index];
        const Vec3 b = mesh_stats.vertices[vertex_index + 1];
        const Vec3 c = mesh_stats.vertices[vertex_index + 2];
        if (triangle_area_2d(a, b, c) <= 1e-8)
            continue;

        const double expand = grid.cell_size * 0.75;
        const int min_ix = int(std::floor((std::min({ a.x, b.x, c.x }) - expand - grid.origin_x) / grid.cell_size));
        const int max_ix = int(std::floor((std::max({ a.x, b.x, c.x }) + expand - grid.origin_x) / grid.cell_size));
        const int min_iy = int(std::floor((std::min({ a.y, b.y, c.y }) - expand - grid.origin_y) / grid.cell_size));
        const int max_iy = int(std::floor((std::max({ a.y, b.y, c.y }) + expand - grid.origin_y) / grid.cell_size));

        for (int iy = min_iy; iy <= max_iy; ++iy) {
            for (int ix = min_ix; ix <= max_ix; ++ix) {
                if (!grid.inside(ix, iy))
                    continue;

                double sampled_z = std::numeric_limits<double>::max();
                if (sample_cell_triangle_z(grid, ix, iy, a, b, c, sampled_z))
                    mark_model_ceiling_cell(grid, ix, iy, sampled_z - settings.effective_top_z_distance_mm());
            }
        }
    }
}

double clamp_to_model_ceiling(const ContactGrid& grid, const int ix, const int iy, const double top_z)
{
    if (!grid.has_model_ceiling(ix, iy))
        return top_z;

    return std::min(top_z, grid.model_ceiling(ix, iy));
}

void mark_contact_cell(ContactGrid& grid, const int ix, const int iy, const double top_z)
{
    if (!grid.inside(ix, iy))
        return;

    const double clamped_top_z = clamp_to_model_ceiling(grid, ix, iy, top_z);
    if (clamped_top_z <= grid.bottom_z + 0.05)
        return;

    double& cell_top = grid.top_z[grid.index(ix, iy)];
    cell_top = std::max(cell_top, clamped_top_z);
}

bool mark_lower_envelope_cell(ContactGrid& grid, const int ix, const int iy, const double top_z)
{
    if (!grid.inside(ix, iy))
        return false;

    const double clamped_top_z = clamp_to_model_ceiling(grid, ix, iy, top_z);
    if (clamped_top_z <= grid.bottom_z + 0.05)
        return false;

    double& cell_top = grid.top_z[grid.index(ix, iy)];
    if (cell_top <= grid.bottom_z + 0.05) {
        cell_top = clamped_top_z;
        return true;
    }

    if (clamped_top_z < cell_top) {
        cell_top = clamped_top_z;
        return true;
    }

    return false;
}

void mark_lower_envelope_target_cell(ContactGrid& grid, const int ix, const int iy, const double top_z)
{
    if (!grid.inside(ix, iy))
        return;

    const double clamped_top_z = clamp_to_model_ceiling(grid, ix, iy, top_z);
    if (clamped_top_z <= grid.bottom_z + 0.05)
        return;

    double& target_top = grid.lower_envelope_z[grid.index(ix, iy)];
    target_top = std::min(target_top, clamped_top_z);
}

void mark_contact_xy(ContactGrid& grid, const double x, const double y, const double top_z)
{
    const int ix = int(std::floor((x - grid.origin_x) / grid.cell_size));
    const int iy = int(std::floor((y - grid.origin_y) / grid.cell_size));
    mark_contact_cell(grid, ix, iy, top_z);
}

void mark_triangle_contacts(ContactGrid& grid, const Vec3& a, const Vec3& b, const Vec3& c, const SupportSettings& settings)
{
    const double top_z = std::max(grid.bottom_z, std::min({ a.z, b.z, c.z }) - settings.effective_top_z_distance_mm());
    if (top_z <= grid.bottom_z + 0.05)
        return;

    const double expand = settings.xy_distance_mm + grid.cell_size * 0.55;
    const int min_ix = int(std::floor((std::min({ a.x, b.x, c.x }) - expand - grid.origin_x) / grid.cell_size));
    const int max_ix = int(std::floor((std::max({ a.x, b.x, c.x }) + expand - grid.origin_x) / grid.cell_size));
    const int min_iy = int(std::floor((std::min({ a.y, b.y, c.y }) - expand - grid.origin_y) / grid.cell_size));
    const int max_iy = int(std::floor((std::max({ a.y, b.y, c.y }) + expand - grid.origin_y) / grid.cell_size));

    for (int iy = min_iy; iy <= max_iy; ++iy) {
        for (int ix = min_ix; ix <= max_ix; ++ix) {
            const Vec3 cell_center {
                grid.origin_x + (double(ix) + 0.5) * grid.cell_size,
                grid.origin_y + (double(iy) + 0.5) * grid.cell_size,
                top_z
            };
            if (point_near_triangle_xy(cell_center, a, b, c, settings.xy_distance_mm))
                mark_contact_cell(grid, ix, iy, top_z);
        }
    }

    mark_contact_xy(grid, (a.x + b.x + c.x) / 3.0, (a.y + b.y + c.y) / 3.0, top_z);
}

void record_coverage_sample(CoverageSamples& coverage, const Vec3& center, const bool supported)
{
    if (supported)
        ++coverage.supported_cells;
    else
        ++coverage.unsupported_cells;

    constexpr std::size_t max_cells = 14000;
    const std::size_t total = coverage.supported_cells + coverage.unsupported_cells;
    const std::size_t stride = std::max<std::size_t>(1, total / max_cells);
    if (coverage.cells.size() < max_cells && total % stride == 0)
        coverage.cells.push_back({ center, supported });
}

double minimum_lower_envelope_normal_z(const SupportSettings& settings)
{
    const double threshold_normal_z = std::sin(settings.threshold_angle_deg * kPi / 180.0);
    return std::clamp(std::max(0.02, threshold_normal_z), 0.0, 0.98);
}

std::size_t mark_lower_envelope_contacts(ContactGrid& grid, const MeshStats& mesh_stats, const SupportSettings& settings, CoverageSamples& coverage)
{
    std::size_t marked_cells = 0;
    const double min_surface_normal_z = minimum_lower_envelope_normal_z(settings);
    for (std::size_t vertex_index = 0; vertex_index + 2 < mesh_stats.vertices.size(); vertex_index += 3) {
        const Vec3 a = mesh_stats.vertices[vertex_index];
        const Vec3 b = mesh_stats.vertices[vertex_index + 1];
        const Vec3 c = mesh_stats.vertices[vertex_index + 2];
        if (triangle_area_2d(a, b, c) <= 1e-8)
            continue;

        const Vec3 normal = cross(subtract(b, a), subtract(c, a));
        const double normal_length = length(normal);
        if (normal_length <= 1e-9)
            continue;

        const double normal_z = normal.z / normal_length;
        if (std::abs(normal_z) < min_surface_normal_z)
            continue;

        const double expand = grid.cell_size * 0.9;
        const int min_ix = int(std::floor((std::min({ a.x, b.x, c.x }) - expand - grid.origin_x) / grid.cell_size));
        const int max_ix = int(std::floor((std::max({ a.x, b.x, c.x }) + expand - grid.origin_x) / grid.cell_size));
        const int min_iy = int(std::floor((std::min({ a.y, b.y, c.y }) - expand - grid.origin_y) / grid.cell_size));
        const int max_iy = int(std::floor((std::max({ a.y, b.y, c.y }) + expand - grid.origin_y) / grid.cell_size));

        for (int iy = min_iy; iy <= max_iy; ++iy) {
            for (int ix = min_ix; ix <= max_ix; ++ix) {
                double model_z = 0.0;
                if (!sample_cell_triangle_z(grid, ix, iy, a, b, c, model_z))
                    continue;

                const double top_z = std::max(grid.bottom_z, model_z - settings.effective_top_z_distance_mm());
                if (grid.has_model_ceiling(ix, iy) && top_z > grid.model_ceiling(ix, iy) + grid.cell_size * 0.1)
                    continue;
                const bool supportable = top_z > grid.bottom_z + 0.05;
                const Vec3 cell_center {
                    grid.origin_x + (double(ix) + 0.5) * grid.cell_size,
                    grid.origin_y + (double(iy) + 0.5) * grid.cell_size,
                    top_z
                };
                record_coverage_sample(coverage, { cell_center.x, cell_center.y, top_z }, supportable);
                if (!supportable)
                    continue;
                mark_lower_envelope_target_cell(grid, ix, iy, top_z);
                if (mark_lower_envelope_cell(grid, ix, iy, top_z))
                    ++marked_cells;
            }
        }
    }

    return marked_cells;
}

std::size_t prune_sparse_auto_contacts(ContactGrid& grid)
{
    const std::vector<double> source_top = grid.top_z;
    const std::vector<double> source_target = grid.lower_envelope_z;
    std::vector<unsigned char> remove(source_top.size(), 0);
    const double comparable_height_mm = std::max(1.5, grid.cell_size * 1.75);

    auto has_target = [&](const int ix, const int iy) {
        return grid.inside(ix, iy) && source_target[grid.index(ix, iy)] < std::numeric_limits<double>::max() * 0.5;
    };

    auto occupied = [&](const int ix, const int iy) {
        return grid.inside(ix, iy) && source_top[grid.index(ix, iy)] > grid.bottom_z + 0.05;
    };

    for (int iy = 0; iy < grid.rows; ++iy) {
        for (int ix = 0; ix < grid.cols; ++ix) {
            const int cell_index = grid.index(ix, iy);
            if (!occupied(ix, iy) || !has_target(ix, iy))
                continue;

            int comparable_neighbors = 0;
            for (int dy = -1; dy <= 1; ++dy) {
                for (int dx = -1; dx <= 1; ++dx) {
                    if (dx == 0 && dy == 0)
                        continue;
                    if (!occupied(ix + dx, iy + dy) || !has_target(ix + dx, iy + dy))
                        continue;

                    const double neighbor_top = source_top[grid.index(ix + dx, iy + dy)];
                    if (std::abs(neighbor_top - source_top[cell_index]) <= comparable_height_mm)
                        ++comparable_neighbors;
                }
            }

            if (comparable_neighbors < 3)
                remove[std::size_t(cell_index)] = 1;
        }
    }

    std::size_t removed = 0;
    for (std::size_t index = 0; index < remove.size(); ++index) {
        if (!remove[index])
            continue;

        grid.top_z[index] = grid.bottom_z;
        grid.lower_envelope_z[index] = std::numeric_limits<double>::max();
        ++removed;
    }

    return removed;
}

std::size_t prune_small_contact_islands(ContactGrid& grid, const SupportSettings& settings)
{
    if (!settings.remove_small_overhangs)
        return 0;

    const double cell_area = std::max(0.01, grid.cell_size * grid.cell_size);
    const int min_cells = std::max(4, int(std::ceil(4.0 / cell_area)));
    std::vector<unsigned char> visited(grid.top_z.size(), 0);
    std::vector<int> stack;
    std::vector<int> component;
    std::size_t removed = 0;

    auto auto_contact = [&](const int ix, const int iy) {
        if (!grid.inside(ix, iy))
            return false;
        const int cell_index = grid.index(ix, iy);
        return grid.top_z[cell_index] > grid.bottom_z + 0.05 &&
            grid.lower_envelope_z[cell_index] < std::numeric_limits<double>::max() * 0.5;
    };

    for (int iy = 0; iy < grid.rows; ++iy) {
        for (int ix = 0; ix < grid.cols; ++ix) {
            const int seed_index = grid.index(ix, iy);
            if (visited[seed_index] || !auto_contact(ix, iy))
                continue;

            stack.clear();
            component.clear();
            visited[seed_index] = 1;
            stack.push_back(seed_index);

            while (!stack.empty()) {
                const int cell_index = stack.back();
                stack.pop_back();
                component.push_back(cell_index);
                const int cx = cell_index % grid.cols;
                const int cy = cell_index / grid.cols;

                for (int dy = -1; dy <= 1; ++dy) {
                    for (int dx = -1; dx <= 1; ++dx) {
                        if (dx == 0 && dy == 0)
                            continue;

                        const int nx = cx + dx;
                        const int ny = cy + dy;
                        if (!grid.inside(nx, ny))
                            continue;

                        const int neighbor_index = grid.index(nx, ny);
                        if (visited[neighbor_index] || !auto_contact(nx, ny))
                            continue;

                        visited[neighbor_index] = 1;
                        stack.push_back(neighbor_index);
                    }
                }
            }

            if (int(component.size()) >= min_cells)
                continue;

            for (const int cell_index : component) {
                grid.top_z[cell_index] = grid.bottom_z;
                grid.lower_envelope_z[cell_index] = std::numeric_limits<double>::max();
                ++removed;
            }
        }
    }

    return removed;
}

std::size_t mark_manual_support(ContactGrid& grid, const Vec3& point, const SupportSettings& settings)
{
    const double radius = settings.manual_contact_radius_mm;
    const double top_z = std::max(grid.bottom_z, point.z - settings.effective_top_z_distance_mm());
    const int min_ix = int(std::floor((point.x - radius - grid.origin_x) / grid.cell_size));
    const int max_ix = int(std::floor((point.x + radius - grid.origin_x) / grid.cell_size));
    const int min_iy = int(std::floor((point.y - radius - grid.origin_y) / grid.cell_size));
    const int max_iy = int(std::floor((point.y + radius - grid.origin_y) / grid.cell_size));
    std::size_t valid_cells = 0;

    for (int iy = min_iy; iy <= max_iy; ++iy) {
        for (int ix = min_ix; ix <= max_ix; ++ix) {
            const double cx = grid.origin_x + (double(ix) + 0.5) * grid.cell_size;
            const double cy = grid.origin_y + (double(iy) + 0.5) * grid.cell_size;
            if (!grid.has_model_ceiling(ix, iy))
                continue;
            if (std::hypot(cx - point.x, cy - point.y) <= radius) {
                mark_contact_cell(grid, ix, iy, top_z);
                if (grid.occupied(ix, iy))
                    ++valid_cells;
            }
        }
    }

    return valid_cells;
}

std::size_t count_contact_cells(const ContactGrid& grid)
{
    std::size_t count = 0;
    for (int iy = 0; iy < grid.rows; ++iy)
        for (int ix = 0; ix < grid.cols; ++ix)
            if (grid.occupied(ix, iy))
                ++count;
    return count;
}

std::size_t close_contact_gaps(ContactGrid& grid)
{
    std::vector<double> closed = grid.top_z;
    std::size_t filled = 0;

    for (int iy = 1; iy + 1 < grid.rows; ++iy) {
        for (int ix = 1; ix + 1 < grid.cols; ++ix) {
            if (grid.occupied(ix, iy))
                continue;

            std::size_t occupied_neighbors = 0;
            std::vector<double> neighbor_tops;
            neighbor_tops.reserve(8);
            for (int dy = -1; dy <= 1; ++dy) {
                for (int dx = -1; dx <= 1; ++dx) {
                    if (dx == 0 && dy == 0)
                        continue;
                    if (!grid.occupied(ix + dx, iy + dy))
                        continue;
                    ++occupied_neighbors;
                    neighbor_tops.push_back(grid.top(ix + dx, iy + dy));
                }
            }

            if (occupied_neighbors >= 5 && !neighbor_tops.empty()) {
                std::sort(neighbor_tops.begin(), neighbor_tops.end());
                const double neighbor_top = neighbor_tops[neighbor_tops.size() / 2];
                const double clamped_top = clamp_to_model_ceiling(grid, ix, iy, neighbor_top);
                if (clamped_top <= grid.bottom_z + 0.05)
                    continue;
                closed[grid.index(ix, iy)] = clamped_top;
                ++filled;
            }
        }
    }

    grid.top_z = std::move(closed);
    return filled;
}

std::size_t apply_xy_edge_clearance(ContactGrid& grid, const double gap_mm)
{
    if (gap_mm <= 0.01)
        return 0;

    const std::vector<double> source = grid.top_z;
    std::vector<double> eroded = grid.top_z;
    const int radius_cells = std::max(1, int(std::ceil((gap_mm + grid.cell_size * 0.55) / grid.cell_size)));
    const double required_radius = gap_mm + grid.cell_size * 0.45;
    std::size_t removed = 0;

    auto source_occupied = [&](const int ix, const int iy) {
        return grid.inside(ix, iy) && source[grid.index(ix, iy)] > grid.bottom_z + 0.05;
    };

    for (int iy = 0; iy < grid.rows; ++iy) {
        for (int ix = 0; ix < grid.cols; ++ix) {
            const int cell_index = grid.index(ix, iy);
            if (source[cell_index] <= grid.bottom_z + 0.05)
                continue;

            bool keep = true;
            for (int dy = -radius_cells; dy <= radius_cells && keep; ++dy) {
                for (int dx = -radius_cells; dx <= radius_cells; ++dx) {
                    if (std::hypot(double(dx), double(dy)) * grid.cell_size > required_radius)
                        continue;
                    if (source_occupied(ix + dx, iy + dy))
                        continue;

                    keep = false;
                    break;
                }
            }

            if (!keep) {
                eroded[cell_index] = grid.bottom_z;
                ++removed;
            }
        }
    }

    grid.top_z = std::move(eroded);
    return removed;
}

std::size_t grow_base_footprint(ContactGrid& grid, const double margin_mm, const double base_thickness_mm)
{
    if (margin_mm < 0.01 || base_thickness_mm <= grid.bottom_z + 0.05)
        return 0;

    std::vector<std::array<int, 2>> occupied_cells;
    occupied_cells.reserve(grid.top_z.size());
    for (int iy = 0; iy < grid.rows; ++iy)
        for (int ix = 0; ix < grid.cols; ++ix)
            if (grid.occupied(ix, iy))
                occupied_cells.push_back({ ix, iy });

    const int radius_cells = std::max(1, int(std::ceil(margin_mm / grid.cell_size)));
    std::size_t base_cells = 0;

    for (const auto& cell : occupied_cells) {
        for (int dy = -radius_cells; dy <= radius_cells; ++dy) {
            for (int dx = -radius_cells; dx <= radius_cells; ++dx) {
                if (std::hypot(double(dx), double(dy)) * grid.cell_size > margin_mm)
                    continue;

                const int ix = cell[0] + dx;
                const int iy = cell[1] + dy;
                if (!grid.inside(ix, iy))
                    continue;

                double& cell_top = grid.top_z[grid.index(ix, iy)];
                const double clamped_base_top = clamp_to_model_ceiling(grid, ix, iy, base_thickness_mm);
                if (clamped_base_top > grid.bottom_z + 0.05 && cell_top < clamped_base_top - 0.05) {
                    cell_top = clamped_base_top;
                    ++base_cells;
                }
            }
        }
    }

    return base_cells;
}

void smooth_contact_heights(ContactGrid& grid, const double base_thickness_mm)
{
    std::vector<double> smoothed = grid.top_z;

    for (int iy = 1; iy + 1 < grid.rows; ++iy) {
        for (int ix = 1; ix + 1 < grid.cols; ++ix) {
            if (!grid.occupied(ix, iy))
                continue;

            const double current = grid.top(ix, iy);
            if (current <= base_thickness_mm + 0.05)
                continue;

            double sum = current * 2.0;
            double weight = 2.0;
            for (int dy = -1; dy <= 1; ++dy) {
                for (int dx = -1; dx <= 1; ++dx) {
                    if (dx == 0 && dy == 0)
                        continue;
                    if (!grid.occupied(ix + dx, iy + dy))
                        continue;

                    const double neighbor = grid.top(ix + dx, iy + dy);
                    if (neighbor <= base_thickness_mm + 0.05)
                        continue;
                    sum += neighbor;
                    weight += 1.0;
                }
            }

            if (weight >= 5.0)
                smoothed[grid.index(ix, iy)] = std::max(base_thickness_mm, sum / weight);
        }
    }

    grid.top_z = std::move(smoothed);
}

std::size_t restore_lower_envelope_contact_heights(ContactGrid& grid, const std::vector<unsigned char>& contact_mask)
{
    std::size_t restored = 0;
    constexpr double tolerance_mm = 0.05;

    for (int iy = 0; iy < grid.rows; ++iy) {
        for (int ix = 0; ix < grid.cols; ++ix) {
            const int cell_index = grid.index(ix, iy);
            if (cell_index >= int(contact_mask.size()) || !contact_mask[std::size_t(cell_index)])
                continue;

            const double target_top = grid.lower_envelope_z[cell_index];
            if (target_top >= std::numeric_limits<double>::max() * 0.5 || !grid.occupied(ix, iy))
                continue;

            const double clamped_target_top = clamp_to_model_ceiling(grid, ix, iy, target_top);
            if (clamped_target_top <= grid.bottom_z + tolerance_mm)
                continue;

            if (grid.top_z[cell_index] < clamped_target_top - tolerance_mm) {
                grid.top_z[cell_index] = clamped_target_top;
                ++restored;
            }
        }
    }

    return restored;
}

void clamp_grid_to_model_ceiling(ContactGrid& grid)
{
    for (int iy = 0; iy < grid.rows; ++iy) {
        for (int ix = 0; ix < grid.cols; ++ix) {
            const int cell_index = grid.index(ix, iy);
            if (!grid.has_model_ceiling(ix, iy))
                continue;

            grid.top_z[cell_index] = std::min(grid.top_z[cell_index], grid.model_ceiling(ix, iy));
            if (grid.top_z[cell_index] <= grid.bottom_z + 0.05)
                grid.top_z[cell_index] = grid.bottom_z;
        }
    }
}

bool has_lower_envelope_target(const ContactGrid& grid, const int ix, const int iy)
{
    return grid.inside(ix, iy) && grid.lower_envelope_z[grid.index(ix, iy)] < std::numeric_limits<double>::max() * 0.5;
}

bool reaches_lower_envelope_target(const ContactGrid& grid, const int ix, const int iy)
{
    if (!has_lower_envelope_target(grid, ix, iy) || !grid.occupied(ix, iy))
        return false;

    constexpr double support_reach_tolerance_mm = 0.1;
    return grid.top(ix, iy) >= grid.lower_envelope_z[grid.index(ix, iy)] - support_reach_tolerance_mm;
}

QaStats evaluate_support_qa(const ContactGrid& grid, const SupportSettings& settings)
{
    QaStats qa;
    constexpr double tolerance_mm = 0.05;

    for (int iy = 0; iy < grid.rows; ++iy) {
        for (int ix = 0; ix < grid.cols; ++ix) {
            const int cell_index = grid.index(ix, iy);

            if (has_lower_envelope_target(grid, ix, iy)) {
                ++qa.downward_cells;
                if (reaches_lower_envelope_target(grid, ix, iy))
                    ++qa.supported_downward_cells;
                else
                    ++qa.unsupported_downward_cells;
            }

            if (!grid.occupied(ix, iy) || !grid.has_model_ceiling(ix, iy))
                continue;

            const double support_top = grid.top(ix, iy);
            const double desired_ceiling = grid.model_ceiling(ix, iy);
            const double clearance_violation = support_top - desired_ceiling;
            if (clearance_violation > tolerance_mm) {
                ++qa.clearance_violation_cells;
                qa.max_clearance_violation_mm = std::max(qa.max_clearance_violation_mm, clearance_violation);
            }

            const double model_surface_z = desired_ceiling + settings.effective_top_z_distance_mm();
            const double penetration = support_top - model_surface_z;
            if (penetration > tolerance_mm) {
                ++qa.intersection_cells;
                qa.max_penetration_mm = std::max(qa.max_penetration_mm, penetration);
            }
        }
    }

    if (qa.downward_cells > 0) {
        qa.supported_downward_percent = 100.0 * double(qa.supported_downward_cells) / double(qa.downward_cells);
    }

    return qa;
}

void update_coverage_from_final_grid(CoverageSamples& coverage, const ContactGrid& grid, const QaStats& qa)
{
    coverage.cells.clear();
    coverage.supported_cells = 0;
    coverage.unsupported_cells = 0;

    for (int iy = 0; iy < grid.rows; ++iy) {
        for (int ix = 0; ix < grid.cols; ++ix) {
            if (!has_lower_envelope_target(grid, ix, iy))
                continue;

            const int cell_index = grid.index(ix, iy);
            const Vec3 center {
                grid.origin_x + (double(ix) + 0.5) * grid.cell_size,
                grid.origin_y + (double(iy) + 0.5) * grid.cell_size,
                grid.lower_envelope_z[cell_index]
            };
            record_coverage_sample(coverage, center, reaches_lower_envelope_target(grid, ix, iy));
        }
    }

    coverage.supported_cells = qa.supported_downward_cells;
    coverage.unsupported_cells = qa.unsupported_downward_cells;
}

bool layer_cell_occupied(const ContactGrid& grid, const std::vector<double>& bottom_z, const std::vector<double>& top_z, const int ix, const int iy)
{
    if (!grid.inside(ix, iy))
        return false;

    const int cell_index = grid.index(ix, iy);
    return top_z[cell_index] > bottom_z[cell_index] + 0.05;
}

double layer_cell_top(const ContactGrid& grid, const std::vector<double>& bottom_z, const std::vector<double>& top_z, const int ix, const int iy)
{
    if (!layer_cell_occupied(grid, bottom_z, top_z, ix, iy))
        return grid.bottom_z;

    return top_z[grid.index(ix, iy)];
}

double layer_cell_bottom(const ContactGrid& grid, const std::vector<double>& bottom_z, const std::vector<double>& top_z, const int ix, const int iy)
{
    if (!layer_cell_occupied(grid, bottom_z, top_z, ix, iy))
        return grid.bottom_z;

    return bottom_z[grid.index(ix, iy)];
}

void add_cell_side_quad(SupportMesh& out, const int dx, const int dy, const double x0, const double x1, const double y0, const double y1, const double z0, const double z1)
{
    if (z1 <= z0 + 0.05)
        return;

    if (dx < 0)
        add_quad(out, { x0, y1, z0 }, { x0, y0, z0 }, { x0, y0, z1 }, { x0, y1, z1 });
    else if (dx > 0)
        add_quad(out, { x1, y0, z0 }, { x1, y1, z0 }, { x1, y1, z1 }, { x1, y0, z1 });
    else if (dy < 0)
        add_quad(out, { x0, y0, z0 }, { x1, y0, z0 }, { x1, y0, z1 }, { x0, y0, z1 });
    else
        add_quad(out, { x1, y1, z0 }, { x0, y1, z0 }, { x0, y1, z1 }, { x1, y1, z1 });
}

void mesh_height_field(const ContactGrid& grid, const std::vector<double>& bottom_z, const std::vector<double>& top_z, SupportMesh& out)
{
    for (int iy = 0; iy < grid.rows; ++iy) {
        for (int ix = 0; ix < grid.cols; ++ix) {
            if (!layer_cell_occupied(grid, bottom_z, top_z, ix, iy))
                continue;

            const double x0 = grid.origin_x + double(ix) * grid.cell_size;
            const double x1 = x0 + grid.cell_size;
            const double y0 = grid.origin_y + double(iy) * grid.cell_size;
            const double y1 = y0 + grid.cell_size;
            const double z0 = bottom_z[grid.index(ix, iy)];
            const double z1 = top_z[grid.index(ix, iy)];

            add_quad(out, { x0, y0, z1 }, { x1, y0, z1 }, { x1, y1, z1 }, { x0, y1, z1 });
            add_quad(out, { x0, y1, z0 }, { x1, y1, z0 }, { x1, y0, z0 }, { x0, y0, z0 });

            const std::array<std::array<int, 2>, 4> neighbors { {
                { -1, 0 },
                { 1, 0 },
                { 0, -1 },
                { 0, 1 },
            } };

            for (const auto& neighbor : neighbors) {
                const int nx = ix + neighbor[0];
                const int ny = iy + neighbor[1];
                if (!layer_cell_occupied(grid, bottom_z, top_z, nx, ny)) {
                    add_cell_side_quad(out, neighbor[0], neighbor[1], x0, x1, y0, y1, z0, z1);
                    continue;
                }

                const double neighbor_bottom = layer_cell_bottom(grid, bottom_z, top_z, nx, ny);
                const double neighbor_top = layer_cell_top(grid, bottom_z, top_z, nx, ny);
                add_cell_side_quad(out, neighbor[0], neighbor[1], x0, x1, y0, y1, z0, std::min(z1, neighbor_bottom));
                add_cell_side_quad(out, neighbor[0], neighbor[1], x0, x1, y0, y1, std::max(z0, neighbor_top), z1);
            }
        }
    }
}

std::vector<unsigned char> snapshot_occupied_cells(const ContactGrid& grid)
{
    std::vector<unsigned char> occupied(grid.top_z.size(), 0);
    for (int iy = 0; iy < grid.rows; ++iy) {
        for (int ix = 0; ix < grid.cols; ++ix) {
            if (grid.occupied(ix, iy))
                occupied[grid.index(ix, iy)] = 1;
        }
    }

    return occupied;
}

std::size_t count_masked_cells(const std::vector<unsigned char>& mask)
{
    std::size_t count = 0;
    for (const unsigned char value : mask)
        if (value)
            ++count;
    return count;
}

std::size_t mesh_contact_grid(
    const ContactGrid& grid,
    const SupportSettings& settings,
    const std::vector<unsigned char>& interface_eligible,
    SupportMesh& support_out,
    SupportMesh& interface_out)
{
    std::vector<double> support_bottom(grid.top_z.size(), grid.bottom_z);
    std::vector<double> support_top = grid.top_z;
    std::vector<double> interface_bottom(grid.top_z.size(), grid.bottom_z);
    std::vector<double> interface_top(grid.top_z.size(), grid.bottom_z);

    const double interface_thickness = settings.interface_thickness_mm();
    if (interface_thickness > 0.05) {
        for (int iy = 0; iy < grid.rows; ++iy) {
            for (int ix = 0; ix < grid.cols; ++ix) {
                if (!grid.occupied(ix, iy))
                    continue;

                const int cell_index = grid.index(ix, iy);
                if (cell_index >= int(interface_eligible.size()) || !interface_eligible[std::size_t(cell_index)])
                    continue;

                const double top_z = grid.top_z[cell_index];
                const double split_z = std::max(grid.bottom_z, top_z - interface_thickness);
                support_top[cell_index] = split_z;
                interface_bottom[cell_index] = split_z;
                interface_top[cell_index] = top_z;
            }
        }
    }

    mesh_height_field(grid, support_bottom, support_top, support_out);
    if (interface_thickness > 0.05)
        mesh_height_field(grid, interface_bottom, interface_top, interface_out);
    return 0;
}

SupportGenerationStats generate_orca_contact_proxy(
    const MeshStats& mesh_stats,
    const SupportSettings& settings,
    const std::vector<Vec3>& manual_points,
    CoverageSamples& coverage,
    QaStats& qa,
    SupportMesh& support_out,
    SupportMesh& interface_out)
{
    SupportGenerationStats stats;
    if (!settings.enable_support || mesh_stats.vertices.size() < 3)
        return stats;

    const double support_cutoff_z = -std::sin(settings.threshold_angle_deg * kPi / 180.0);
    ContactGrid grid = make_contact_grid(mesh_stats, settings);
    populate_model_collision_ceiling(grid, mesh_stats, settings);

    for (std::size_t vertex_index = 0; vertex_index + 2 < mesh_stats.vertices.size(); vertex_index += 3) {
        const Vec3 a = mesh_stats.vertices[vertex_index];
        const Vec3 b = mesh_stats.vertices[vertex_index + 1];
        const Vec3 c = mesh_stats.vertices[vertex_index + 2];
        const Vec3 normal = cross(subtract(b, a), subtract(c, a));
        const double normal_length = length(normal);
        if (normal_length <= 1e-9)
            continue;

        const double normal_z = normal.z / normal_length;
        if (normal_z >= support_cutoff_z)
            continue;

        ++stats.overhang_facets;
    }

    stats.envelope_cells = mark_lower_envelope_contacts(grid, mesh_stats, settings, coverage);
    stats.pruned_sparse_cells = prune_sparse_auto_contacts(grid);
    stats.pruned_small_island_cells = prune_small_contact_islands(grid, settings);

    for (const Vec3& point : manual_points) {
        if (mark_manual_support(grid, point, settings) > 0)
            ++stats.manual_points;
    }

    stats.closed_gap_cells = close_contact_gaps(grid);
    clamp_grid_to_model_ceiling(grid);
    stats.edge_clearance_removed_cells = apply_xy_edge_clearance(grid, settings.edge_clearance_mm);
    stats.foam_gap_removed_cells = apply_xy_edge_clearance(grid, settings.effective_foam_gap_xy_mm());
    clamp_grid_to_model_ceiling(grid);
    stats.contact_cells = count_contact_cells(grid);
    qa = evaluate_support_qa(grid, settings);
    update_coverage_from_final_grid(coverage, grid, qa);
    if (stats.contact_cells == 0)
        return stats;

    const std::vector<unsigned char> interface_eligible = snapshot_occupied_cells(grid);

    if (settings.base_enabled)
        stats.base_cells = grow_base_footprint(grid, settings.base_margin_mm, settings.base_thickness_mm);

    restore_lower_envelope_contact_heights(grid, interface_eligible);
    clamp_grid_to_model_ceiling(grid);
    qa = evaluate_support_qa(grid, settings);
    update_coverage_from_final_grid(coverage, grid, qa);
    if (settings.interface_top_layers > 0)
        stats.interface_cells = count_masked_cells(interface_eligible);
    stats.tree_branches = mesh_contact_grid(grid, settings, interface_eligible, support_out, interface_out);

    return stats;
}

void append_number(std::ostringstream& out, const double value)
{
    out << value;
}

void append_support_mesh_json(std::ostringstream& out, const char* key, const SupportMesh& mesh, const double cell_size_mm)
{
    out << "\"" << key << R"json(":{"coordinate_space":"world_mm","triangle_encoding":"indexed_triangles","cell_size_mm":)json";
    append_number(out, cell_size_mm);
    out << R"json(,"vertex_count":)json"
        << mesh.vertices.size()
        << R"json(,"triangle_count":)json"
        << mesh.triangles.size()
        << R"json(,"vertices":[)json";

    for (std::size_t index = 0; index < mesh.vertices.size(); ++index) {
        if (index > 0)
            out << ",";
        append_number(out, mesh.vertices[index].x);
        out << ",";
        append_number(out, mesh.vertices[index].y);
        out << ",";
        append_number(out, mesh.vertices[index].z);
    }

    out << R"json(],"triangles":[)json";
    for (std::size_t index = 0; index < mesh.triangles.size(); ++index) {
        if (index > 0)
            out << ",";
        out << mesh.triangles[index][0] << "," << mesh.triangles[index][1] << "," << mesh.triangles[index][2];
    }
    out << "]}";
}

void append_coverage_json(std::ostringstream& out, const CoverageSamples& coverage)
{
    out << R"json("coverage":{"supported_cells":)json"
        << coverage.supported_cells
        << R"json(,"unsupported_cells":)json"
        << coverage.unsupported_cells
        << R"json(,"cells":[)json";

    for (std::size_t index = 0; index < coverage.cells.size(); ++index) {
        if (index > 0)
            out << ",";
        out << "[";
        append_number(out, coverage.cells[index].center.x);
        out << ",";
        append_number(out, coverage.cells[index].center.y);
        out << ",";
        append_number(out, coverage.cells[index].center.z);
        out << ",";
        out << (coverage.cells[index].supported ? "1" : "0");
        out << "]";
    }

    out << "]}";
}

void append_qa_json(std::ostringstream& out, const QaStats& qa)
{
    out << R"json("qa":{"intersects_model":)json"
        << (qa.intersection_cells > 0 ? "true" : "false")
        << R"json(,"intersection_cells":)json"
        << qa.intersection_cells
        << R"json(,"max_penetration_mm":)json";
    append_number(out, qa.max_penetration_mm);
    out << R"json(,"clearance_violation_cells":)json"
        << qa.clearance_violation_cells
        << R"json(,"max_clearance_violation_mm":)json";
    append_number(out, qa.max_clearance_violation_mm);
    out << R"json(,"downward_cells":)json"
        << qa.downward_cells
        << R"json(,"supported_downward_cells":)json"
        << qa.supported_downward_cells
        << R"json(,"unsupported_downward_cells":)json"
        << qa.unsupported_downward_cells
        << R"json(,"supported_downward_percent":)json";
    append_number(out, qa.supported_downward_percent);
    out << "}";
}

} // namespace

std::string core_status()
{
    return "Cradlemaker WASM support core loaded";
}

std::string core_version()
{
    return "0.8.5";
}

std::string support_option_schema_json()
{
    return R"json([
{"key":"enable_support","type":"bool"},
{"key":"support_interface_enabled","type":"bool"},
{"key":"foam_gap_enabled","type":"bool"},
{"key":"support_type","type":"enum"},
{"key":"support_style","type":"enum"},
{"key":"support_base_pattern","type":"enum"},
{"key":"support_interface_pattern","type":"enum"},
{"key":"support_threshold_angle","type":"int"},
{"key":"support_threshold_overlap","type":"float_or_percent"},
{"key":"support_on_build_plate_only","type":"bool"},
{"key":"support_critical_regions_only","type":"bool"},
{"key":"support_remove_small_overhang","type":"bool"},
{"key":"support_top_z_distance","type":"float"},
{"key":"support_bottom_z_distance","type":"float"},
{"key":"support_object_xy_distance","type":"float"},
{"key":"support_edge_clearance_mm","type":"float"},
{"key":"support_base_pattern_spacing","type":"float"},
{"key":"support_interface_top_layers","type":"int"},
{"key":"support_interface_bottom_layers","type":"int"},
{"key":"support_interface_spacing","type":"float"},
{"key":"support_bottom_interface_spacing","type":"float"},
{"key":"foam_gap_z_mm","type":"float"},
{"key":"foam_gap_xy_mm","type":"float"},
{"key":"tree_support_branch_distance","type":"float"},
{"key":"tree_support_tip_diameter","type":"float"},
{"key":"tree_support_branch_diameter","type":"float"},
{"key":"tree_support_branch_angle","type":"float"},
{"key":"tree_support_wall_count","type":"int"}
])json";
}

std::string support_core_plan_json()
{
    return Cradlemaker::OrcaSupportBridge::real_orca_support_plan_json();
}

std::string prepare_support_job_json(const std::string& job_json)
{
    MeshStats mesh_stats;
    const bool parsed_vertices = parse_numeric_array_after_key(job_json, "vertices", mesh_stats);
    const std::size_t declared_vertex_count = read_unsigned_field(job_json, "vertex_count");
    const std::size_t declared_triangle_count = read_unsigned_field(job_json, "triangle_count");
    const bool nonindexed_triplets = contains_json_string(job_json, "nonindexed_triplets");
    const bool mesh_ready = parsed_vertices && mesh_stats.vertex_values > 0 && mesh_stats.vertex_values % 9 == 0 && nonindexed_triplets;
    const SupportSettings settings = read_support_settings(job_json);
    const std::vector<Vec3> manual_points = read_manual_support_points(job_json);
    SupportMesh support_mesh;
    SupportMesh interface_mesh;
    CoverageSamples coverage;
    QaStats qa;
    const SupportGenerationStats support_stats = mesh_ready ? generate_orca_contact_proxy(mesh_stats, settings, manual_points, coverage, qa, support_mesh, interface_mesh) : SupportGenerationStats {};
    const bool support_ready = mesh_ready && support_stats.contact_cells > 0 && (!support_mesh.triangles.empty() || !interface_mesh.triangles.empty());

    std::ostringstream out;
    out.precision(6);
    out << R"json({"status":")json"
        << (support_ready ? "support_mesh_generated" : (mesh_ready ? "no_support_regions" : "mesh_job_invalid"))
        << R"json(","native_target":"cradlemaker_support_core","algorithm":"cradle_lower_envelope_grid","message":")json"
        << (settings.requested_orca_tree_mode && !Cradlemaker::OrcaSupportBridge::real_orca_tree_support_available() ?
            "Real Orca organic tree support is not linked into WASM yet; generated the stable solid cradle fallback." :
            "WASM generated a high-resolution lower-envelope cradle from sliced underside samples with model-clearance trimming.")
        << R"json(","job_bytes":)json"
        << job_json.size()
        << R"json(,"mesh":{"coordinate_space":"world_mm","triangle_encoding":")json"
        << (nonindexed_triplets ? "nonindexed_triplets" : "unknown")
        << R"json(","vertex_values":)json"
        << mesh_stats.vertex_values
        << R"json(,"vertex_count":)json"
        << mesh_stats.vertex_count
        << R"json(,"triangle_count":)json"
        << mesh_stats.triangle_count
        << R"json(,"declared_vertex_count":)json"
        << declared_vertex_count
        << R"json(,"declared_triangle_count":)json"
        << declared_triangle_count
        << R"json(,"bounds_mm":{"min":[)json";
    append_number(out, mesh_stats.has_bounds() ? mesh_stats.min_x : 0.0);
    out << ",";
    append_number(out, mesh_stats.has_bounds() ? mesh_stats.min_y : 0.0);
    out << ",";
    append_number(out, mesh_stats.has_bounds() ? mesh_stats.min_z : 0.0);
    out << R"json(],"max":[)json";
    append_number(out, mesh_stats.has_bounds() ? mesh_stats.max_x : 0.0);
    out << ",";
    append_number(out, mesh_stats.has_bounds() ? mesh_stats.max_y : 0.0);
    out << ",";
    append_number(out, mesh_stats.has_bounds() ? mesh_stats.max_z : 0.0);
    out << R"json(]}},"support":{"overhang_facets":)json"
        << support_stats.overhang_facets
        << R"json(,"threshold_angle_deg":)json";
    append_number(out, settings.threshold_angle_deg);
    out << R"json(,"top_z_distance_mm":)json";
    append_number(out, settings.top_z_distance_mm);
    out << R"json(,"effective_top_z_distance_mm":)json";
    append_number(out, settings.effective_top_z_distance_mm());
    out << R"json(,"xy_distance_mm":)json";
    append_number(out, settings.xy_distance_mm);
    out << R"json(,"edge_clearance_mm":)json";
    append_number(out, settings.edge_clearance_mm);
    out << R"json(,"foam_gap_enabled":)json"
        << (settings.foam_gap_enabled ? "true" : "false")
        << R"json(,"foam_gap_z_mm":)json";
    append_number(out, settings.foam_gap_z_mm);
    out << R"json(,"foam_gap_xy_mm":)json";
    append_number(out, settings.foam_gap_xy_mm);
    out << R"json(,"contact_cell_size_mm":)json";
    append_number(out, settings.contact_cell_size_mm);
    out << R"json(,"interface_top_layers":)json"
        << settings.interface_top_layers
        << R"json(,"interface_thickness_mm":)json";
    append_number(out, settings.interface_thickness_mm());
    out << R"json(,"base_enabled":)json"
        << (settings.base_enabled ? "true" : "false")
        << R"json(,"contact_cells":)json"
        << support_stats.contact_cells
        << R"json(,"envelope_cells":)json"
        << support_stats.envelope_cells
        << R"json(,"pruned_sparse_cells":)json"
        << support_stats.pruned_sparse_cells
        << R"json(,"pruned_small_island_cells":)json"
        << support_stats.pruned_small_island_cells
        << R"json(,"closed_gap_cells":)json"
        << support_stats.closed_gap_cells
        << R"json(,"base_cells":)json"
        << support_stats.base_cells
        << R"json(,"interface_cells":)json"
        << support_stats.interface_cells
        << R"json(,"edge_clearance_removed_cells":)json"
        << support_stats.edge_clearance_removed_cells
        << R"json(,"foam_gap_removed_cells":)json"
        << support_stats.foam_gap_removed_cells
        << R"json(,"manual_points":)json"
        << support_stats.manual_points
        << R"json(,"requested_orca_tree_mode":)json"
        << (settings.requested_orca_tree_mode ? "true" : "false")
        << R"json(,"real_orca_tree_available":)json"
        << (Cradlemaker::OrcaSupportBridge::real_orca_tree_support_available() ? "true" : "false")
        << R"json(,"tree_mode":)json"
        << (settings.tree_mode ? "true" : "false")
        << R"json(,"tree_branches":)json"
        << support_stats.tree_branches
        << R"json(},)json";
    append_support_mesh_json(out, "support_mesh", support_mesh, settings.contact_cell_size_mm);
    out << ",";
    append_support_mesh_json(out, "interface_mesh", interface_mesh, settings.contact_cell_size_mm);
    out << ",";
    append_coverage_json(out, coverage);
    out << ",";
    append_qa_json(out, qa);
    out << "}";
    return out.str();
}

} // namespace Cradlemaker::SupportCore
