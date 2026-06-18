#include "SupportCore.hpp"
#include "OrcaSupportBridge.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <limits>
#include <numeric>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace Cradlemaker::SupportCore {
namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr std::size_t kParallelTriangleThreshold = 8000;

#if defined(__EMSCRIPTEN_PTHREADS__) || !defined(__EMSCRIPTEN__)
#define CRADLEMAKER_CAN_USE_NATIVE_THREADS 1
constexpr bool kCanUseNativeThreads = true;
#else
#define CRADLEMAKER_CAN_USE_NATIVE_THREADS 0
constexpr bool kCanUseNativeThreads = false;
#endif

unsigned support_worker_count(const std::size_t triangle_count)
{
#if CRADLEMAKER_CAN_USE_NATIVE_THREADS
    if (!kCanUseNativeThreads)
        return 1;
    if (triangle_count < kParallelTriangleThreshold)
        return 1;

    const unsigned hardware = std::max(1u, std::thread::hardware_concurrency());
    const unsigned by_work = std::max(1u, unsigned(triangle_count / kParallelTriangleThreshold));
    return std::min({ hardware, by_work, 8u });
#else
    (void)triangle_count;
    return 1;
#endif
}

struct Vec3 {
    double x = 0.0;
    double y = 0.0;
    double z = 0.0;
};

struct ManualSupportPoint {
    Vec3 point;
    double radius = 0.0;
    bool blocker = false;
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

struct PackedSupportMesh {
    std::vector<float> vertices;
    std::vector<std::uint32_t> triangles;
};

struct LastBinarySupportResult {
    PackedSupportMesh support;
    PackedSupportMesh interface_mesh;
};

LastBinarySupportResult g_last_binary_result;
std::vector<float> g_input_vertices;

struct CoverageCell {
    Vec3 center;
    bool supported = false;
};

struct SupportSettings {
    bool enable_support = true;
    bool base_enabled = false;
    bool interface_enabled = false;
    bool foam_gap_enabled = false;
    bool join_uprights_bottom_enabled = true;
    bool support_blocker_cuts_base = false;
    bool merge_nearby_columns_enabled = true;
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
    std::size_t bottom_join_cells = 0;
    std::size_t column_merge_cells = 0;
    std::size_t column_components_before = 0;
    std::size_t column_components_after = 0;
    std::size_t interface_cells = 0;
    std::size_t edge_clearance_removed_cells = 0;
    std::size_t foam_gap_removed_cells = 0;
    std::size_t manual_points = 0;
    std::size_t manual_blocker_points = 0;
    std::size_t manual_blocker_removed_cells = 0;
    std::size_t tree_branches = 0;
    std::size_t tree_tip_contacts = 0;
    std::size_t tree_local_uprights = 0;
    std::size_t tree_waypoint_branches = 0;
    std::size_t tree_slope_reroutes = 0;
    std::size_t tree_model_reroutes = 0;
    double timing_grid_ms = 0.0;
    double timing_model_ceiling_ms = 0.0;
    double timing_overhang_ms = 0.0;
    double timing_lower_envelope_ms = 0.0;
    double timing_prune_ms = 0.0;
    double timing_manual_ms = 0.0;
    double timing_gap_and_clearance_ms = 0.0;
    double timing_qa_ms = 0.0;
    double timing_base_ms = 0.0;
    double timing_mesh_ms = 0.0;
    double timing_input_parse_ms = 0.0;
    double timing_settings_parse_ms = 0.0;
    double timing_generation_total_ms = 0.0;
    double timing_binary_pack_ms = 0.0;
    double timing_json_metadata_ms = 0.0;
};

struct TreeLayerDisk {
    double x = 0.0;
    double y = 0.0;
    double z = 0.0;
    double radius = 0.0;
};

struct OrganicTreeLayerData {
    double bottom_z = 0.0;
    double top_z = 0.0;
    double layer_height = 0.2;
    int circle_segments = 18;
    std::vector<std::vector<TreeLayerDisk>> layers;

    std::size_t disk_count() const
    {
        std::size_t total = 0;
        for (const auto& layer : layers)
            total += layer.size();
        return total;
    }
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

std::vector<ManualSupportPoint> read_manual_support_points(const std::string& json)
{
    std::vector<ManualSupportPoint> points;
    const std::string point_key = "\"point\"";
    std::size_t search_pos = 0;

    while (true) {
        const std::size_t key_pos = json.find(point_key, search_pos);
        if (key_pos == std::string::npos)
            break;

        const std::size_t array_pos = json.find('[', key_pos + point_key.size());
        Vec3 point;
        if (read_vec3_array_at(json, array_pos, point)) {
            const std::size_t object_start = json.rfind('{', key_pos);
            const std::size_t object_end = json.find('}', key_pos);
            const std::string object_json = object_start != std::string::npos && object_end != std::string::npos && object_end > object_start
                ? json.substr(object_start, object_end - object_start + 1)
                : std::string {};
            const std::string source = read_string_field(object_json, "source");
            ManualSupportPoint support;
            support.point = point;
            support.radius = read_number_field(object_json, "radius", 0.0);
            support.blocker = source.find("block") != std::string::npos || source.find("erase") != std::string::npos;
            points.push_back(support);
        }

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
    settings.join_uprights_bottom_enabled = read_bool_field(json, "join_uprights_bottom_enabled", settings.join_uprights_bottom_enabled);
    settings.support_blocker_cuts_base = read_bool_field(json, "support_blocker_cuts_base", settings.support_blocker_cuts_base);
    settings.merge_nearby_columns_enabled = read_bool_field(json, "merge_nearby_columns_enabled", settings.merge_nearby_columns_enabled);
    settings.interface_enabled = read_bool_field(json, "support_interface_enabled", settings.interface_enabled);
    settings.foam_gap_enabled = read_bool_field(json, "foam_gap_enabled", settings.foam_gap_enabled);
    settings.remove_small_overhangs = read_bool_field(json, "support_remove_small_overhang", settings.remove_small_overhangs);
    const std::string support_type = read_string_field(json, "support_type");
    const std::string support_style = read_string_field(json, "support_style");
    settings.requested_orca_tree_mode = support_type.find("tree") != std::string::npos ||
        support_type.find("hybrid") != std::string::npos ||
        support_style.find("tree") != std::string::npos ||
        support_style.find("organic") != std::string::npos;
    settings.tree_mode = settings.requested_orca_tree_mode;
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
    settings.manual_contact_radius_mm = std::clamp(settings.manual_contact_radius_mm, settings.contact_cell_size_mm, 50.0);
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

Vec3 add(const Vec3& lhs, const Vec3& rhs)
{
    return { lhs.x + rhs.x, lhs.y + rhs.y, lhs.z + rhs.z };
}

Vec3 multiply(const Vec3& value, const double scale)
{
    return { value.x * scale, value.y * scale, value.z * scale };
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

Vec3 normalize(const Vec3& value)
{
    const double value_length = length(value);
    if (value_length <= 1e-12)
        return { 0.0, 0.0, 1.0 };
    return { value.x / value_length, value.y / value_length, value.z / value_length };
}

int add_vertex(SupportMesh& mesh, const Vec3& vertex)
{
    mesh.vertices.push_back(vertex);
    return int(mesh.vertices.size() - 1);
}

void add_triangle(SupportMesh& mesh, const Vec3& a, const Vec3& b, const Vec3& c)
{
    if (length(cross(subtract(b, a), subtract(c, a))) <= 1e-8)
        return;

    const int ia = add_vertex(mesh, a);
    const int ib = add_vertex(mesh, b);
    const int ic = add_vertex(mesh, c);
    mesh.triangles.push_back({ ia, ib, ic });
}

void add_indexed_triangle(SupportMesh& mesh, const int ia, const int ib, const int ic)
{
    if (ia == ib || ib == ic || ic == ia)
        return;
    const Vec3& a = mesh.vertices[std::size_t(ia)];
    const Vec3& b = mesh.vertices[std::size_t(ib)];
    const Vec3& c = mesh.vertices[std::size_t(ic)];
    if (length(cross(subtract(b, a), subtract(c, a))) <= 1e-8)
        return;
    mesh.triangles.push_back({ ia, ib, ic });
}

void add_quad(SupportMesh& mesh, const Vec3& a, const Vec3& b, const Vec3& c, const Vec3& d)
{
    add_triangle(mesh, a, b, c);
    add_triangle(mesh, a, c, d);
}

void add_tapered_tube(
    SupportMesh& mesh,
    const Vec3& start,
    const Vec3& end,
    const double start_radius,
    const double end_radius,
    const int segments = 14,
    const bool cap_ends = true)
{
    const Vec3 axis = subtract(end, start);
    const double tube_length = length(axis);
    if (tube_length <= 0.05)
        return;

    const Vec3 w = normalize(axis);
    const Vec3 reference = std::abs(w.z) < 0.92 ? Vec3 { 0.0, 0.0, 1.0 } : Vec3 { 1.0, 0.0, 0.0 };
    const Vec3 u = normalize(cross(w, reference));
    const Vec3 v = normalize(cross(w, u));
    const double r0 = std::max(0.05, start_radius);
    const double r1 = std::max(0.05, end_radius);

    std::vector<Vec3> start_ring;
    std::vector<Vec3> end_ring;
    start_ring.reserve(std::size_t(segments));
    end_ring.reserve(std::size_t(segments));
    for (int index = 0; index < segments; ++index) {
        const double angle = 2.0 * kPi * double(index) / double(segments);
        const Vec3 direction = add(multiply(u, std::cos(angle)), multiply(v, std::sin(angle)));
        start_ring.push_back(add(start, multiply(direction, r0)));
        end_ring.push_back(add(end, multiply(direction, r1)));
    }

    for (int index = 0; index < segments; ++index) {
        const int next = (index + 1) % segments;
        add_quad(mesh, start_ring[index], start_ring[next], end_ring[next], end_ring[index]);
    }

    if (cap_ends) {
        for (int index = 0; index < segments; ++index) {
            const int next = (index + 1) % segments;
            add_triangle(mesh, start, start_ring[index], start_ring[next]);
            add_triangle(mesh, end, end_ring[next], end_ring[index]);
        }
    }
}

Vec3 quadratic_bezier(const Vec3& a, const Vec3& b, const Vec3& c, const double t)
{
    const double u = 1.0 - t;
    return add(add(multiply(a, u * u), multiply(b, 2.0 * u * t)), multiply(c, t * t));
}

double organic_bend_sign(const Vec3& start, const Vec3& end)
{
    const double value = std::sin(start.x * 0.173 + start.y * 0.117 + end.x * 0.071 - end.y * 0.191);
    return value < 0.0 ? -1.0 : 1.0;
}

void add_curved_tube(
    SupportMesh& mesh,
    const Vec3& start,
    const Vec3& end,
    const double start_radius,
    const double end_radius,
    const int curve_segments = 5,
    const int ring_segments = 14)
{
    const Vec3 delta = subtract(end, start);
    const double horizontal = std::hypot(delta.x, delta.y);
    if (length(delta) <= 0.05)
        return;

    const int safe_curve_segments = std::max(2, curve_segments);
    const int safe_ring_segments = std::max(8, ring_segments);
    Vec3 control {
        (start.x + end.x) * 0.5,
        (start.y + end.y) * 0.5,
        (start.z + end.z) * 0.5
    };
    if (horizontal > 0.1) {
        const double bend = std::min(std::max(horizontal * 0.18, std::max(start_radius, end_radius) * 0.35), std::max(1.0, horizontal * 0.35));
        const double sign = organic_bend_sign(start, end);
        control.x += (-delta.y / horizontal) * bend * sign;
        control.y += (delta.x / horizontal) * bend * sign;
    }
    control.z = std::min(start.z, end.z) + std::abs(delta.z) * 0.58;

    std::vector<Vec3> points;
    std::vector<double> radii;
    points.reserve(std::size_t(safe_curve_segments + 1));
    radii.reserve(std::size_t(safe_curve_segments + 1));
    for (int segment = 0; segment <= safe_curve_segments; ++segment) {
        const double t = double(segment) / double(safe_curve_segments);
        points.push_back(quadratic_bezier(start, control, end, t));
        radii.push_back(std::max(0.05, start_radius + (end_radius - start_radius) * t));
    }

    std::vector<std::vector<Vec3>> rings;
    rings.reserve(points.size());
    for (int segment = 0; segment <= safe_curve_segments; ++segment) {
        Vec3 tangent;
        if (segment == 0)
            tangent = subtract(points[1], points[0]);
        else if (segment == safe_curve_segments)
            tangent = subtract(points[std::size_t(segment)], points[std::size_t(segment - 1)]);
        else
            tangent = subtract(points[std::size_t(segment + 1)], points[std::size_t(segment - 1)]);

        const Vec3 w = normalize(tangent);
        const Vec3 reference = std::abs(w.z) < 0.92 ? Vec3 { 0.0, 0.0, 1.0 } : Vec3 { 1.0, 0.0, 0.0 };
        const Vec3 u = normalize(cross(w, reference));
        const Vec3 v = normalize(cross(w, u));
        std::vector<Vec3> ring;
        ring.reserve(std::size_t(safe_ring_segments));
        for (int index = 0; index < safe_ring_segments; ++index) {
            const double angle = 2.0 * kPi * double(index) / double(safe_ring_segments);
            const Vec3 direction = add(multiply(u, std::cos(angle)), multiply(v, std::sin(angle)));
            ring.push_back(add(points[std::size_t(segment)], multiply(direction, radii[std::size_t(segment)])));
        }
        rings.push_back(std::move(ring));
    }

    for (int segment = 0; segment < safe_curve_segments; ++segment) {
        for (int index = 0; index < safe_ring_segments; ++index) {
            const int next = (index + 1) % safe_ring_segments;
            add_quad(
                mesh,
                rings[std::size_t(segment)][std::size_t(index)],
                rings[std::size_t(segment)][std::size_t(next)],
                rings[std::size_t(segment + 1)][std::size_t(next)],
                rings[std::size_t(segment + 1)][std::size_t(index)]);
        }
    }

    for (int index = 0; index < safe_ring_segments; ++index) {
        const int next = (index + 1) % safe_ring_segments;
        add_triangle(mesh, points.front(), rings.front()[std::size_t(index)], rings.front()[std::size_t(next)]);
        add_triangle(mesh, points.back(), rings.back()[std::size_t(next)], rings.back()[std::size_t(index)]);
    }
}

void add_layer_area_branch(
    SupportMesh& mesh,
    const Vec3& start,
    const Vec3& end,
    const double start_radius,
    const double end_radius,
    const int curve_segments = 5,
    const int ring_segments = 14)
{
    const Vec3 delta = subtract(end, start);
    const double horizontal = std::hypot(delta.x, delta.y);
    if (length(delta) <= 0.05 || end.z <= start.z + 0.05)
        return;

    const int safe_curve_segments = std::max(2, curve_segments);
    const int safe_ring_segments = std::max(8, ring_segments);
    Vec3 control {
        (start.x + end.x) * 0.5,
        (start.y + end.y) * 0.5,
        (start.z + end.z) * 0.5
    };
    if (horizontal > 0.1) {
        const double bend = std::min(std::max(horizontal * 0.16, std::max(start_radius, end_radius) * 0.35), std::max(0.7, horizontal * 0.28));
        const double sign = organic_bend_sign(start, end);
        control.x += (-delta.y / horizontal) * bend * sign;
        control.y += (delta.x / horizontal) * bend * sign;
    }
    control.z = start.z + (end.z - start.z) * 0.56;

    const Vec3 axis_xy = horizontal > 0.1 ? Vec3 { delta.x / horizontal, delta.y / horizontal, 0.0 } : Vec3 { 1.0, 0.0, 0.0 };
    const Vec3 normal_xy { -axis_xy.y, axis_xy.x, 0.0 };
    const double branch_slope = horizontal / std::max(0.1, end.z - start.z);
    const double oval_stretch = std::clamp(branch_slope * 0.32, 0.0, 0.55);

    std::vector<Vec3> centers;
    std::vector<double> radii;
    centers.reserve(std::size_t(safe_curve_segments + 1));
    radii.reserve(std::size_t(safe_curve_segments + 1));
    for (int segment = 0; segment <= safe_curve_segments; ++segment) {
        const double t = double(segment) / double(safe_curve_segments);
        Vec3 center = quadratic_bezier(start, control, end, t);
        center.z = start.z + (end.z - start.z) * t;
        centers.push_back(center);
        radii.push_back(std::max(0.05, start_radius + (end_radius - start_radius) * t));
    }

    std::vector<std::vector<Vec3>> rings;
    rings.reserve(centers.size());
    for (int segment = 0; segment <= safe_curve_segments; ++segment) {
        const double radius = radii[std::size_t(segment)];
        const double major = radius * (1.0 + oval_stretch);
        const double minor = std::max(radius * 0.72, radius * (1.0 - oval_stretch * 0.35));
        std::vector<Vec3> ring;
        ring.reserve(std::size_t(safe_ring_segments));
        for (int index = 0; index < safe_ring_segments; ++index) {
            const double angle = 2.0 * kPi * double(index) / double(safe_ring_segments);
            const Vec3 offset = add(
                multiply(axis_xy, std::cos(angle) * major),
                multiply(normal_xy, std::sin(angle) * minor));
            ring.push_back({ centers[std::size_t(segment)].x + offset.x, centers[std::size_t(segment)].y + offset.y, centers[std::size_t(segment)].z });
        }
        rings.push_back(std::move(ring));
    }

    for (int segment = 0; segment < safe_curve_segments; ++segment) {
        for (int index = 0; index < safe_ring_segments; ++index) {
            const int next = (index + 1) % safe_ring_segments;
            add_quad(
                mesh,
                rings[std::size_t(segment)][std::size_t(index)],
                rings[std::size_t(segment)][std::size_t(next)],
                rings[std::size_t(segment + 1)][std::size_t(next)],
                rings[std::size_t(segment + 1)][std::size_t(index)]);
        }
    }

    for (int index = 0; index < safe_ring_segments; ++index) {
        const int next = (index + 1) % safe_ring_segments;
        add_triangle(mesh, centers.front(), rings.front()[std::size_t(next)], rings.front()[std::size_t(index)]);
        add_triangle(mesh, centers.back(), rings.back()[std::size_t(index)], rings.back()[std::size_t(next)]);
    }
}

void add_layer_area_polybranch(
    SupportMesh& mesh,
    const std::vector<Vec3>& source_centers,
    const std::vector<double>& source_radii,
    const int ring_segments = 18)
{
    if (source_centers.size() < 2 || source_centers.size() != source_radii.size())
        return;

    std::vector<Vec3> centers;
    std::vector<double> radii;
    centers.reserve(source_centers.size());
    radii.reserve(source_radii.size());
    centers.push_back(source_centers.front());
    radii.push_back(source_radii.front());

    for (std::size_t index = 1; index + 1 < source_centers.size(); ++index) {
        const Vec3& previous = centers.back();
        const Vec3& current = source_centers[index];
        const Vec3& next = source_centers[index + 1];
        const double keep_distance = std::hypot(previous.x - current.x, previous.y - current.y) + std::abs(current.z - previous.z);
        const Vec3 in = normalize(subtract(current, previous));
        const Vec3 out = normalize(subtract(next, current));
        const double bend = length(cross(in, out));
        if (keep_distance < 1.2 && bend < 0.075)
            continue;
        centers.push_back(current);
        radii.push_back(source_radii[index]);
    }

    centers.push_back(source_centers.back());
    radii.push_back(source_radii.back());
    if (centers.size() < 2)
        return;

    for (int pass = 0; pass < 3 && centers.size() > 3; ++pass) {
        std::vector<Vec3> smoothed_centers = centers;
        std::vector<double> smoothed_radii = radii;
        for (std::size_t index = 1; index + 1 < centers.size(); ++index) {
            smoothed_centers[index] = {
                centers[index - 1].x * 0.22 + centers[index].x * 0.56 + centers[index + 1].x * 0.22,
                centers[index - 1].y * 0.22 + centers[index].y * 0.56 + centers[index + 1].y * 0.22,
                centers[index - 1].z * 0.16 + centers[index].z * 0.68 + centers[index + 1].z * 0.16,
            };
            smoothed_radii[index] = radii[index - 1] * 0.24 + radii[index] * 0.52 + radii[index + 1] * 0.24;
        }
        centers = std::move(smoothed_centers);
        radii = std::move(smoothed_radii);
    }

    const int safe_ring_segments = std::max(12, ring_segments);
    std::vector<std::vector<int>> rings;
    rings.reserve(centers.size());

    for (std::size_t segment = 0; segment < centers.size(); ++segment) {
        Vec3 tangent;
        if (segment == 0)
            tangent = subtract(centers[1], centers[0]);
        else if (segment + 1 == centers.size())
            tangent = subtract(centers[segment], centers[segment - 1]);
        else
            tangent = subtract(centers[segment + 1], centers[segment - 1]);

        const double horizontal = std::hypot(tangent.x, tangent.y);
        const Vec3 axis_xy = horizontal > 0.1 ? Vec3 { tangent.x / horizontal, tangent.y / horizontal, 0.0 } : Vec3 { 1.0, 0.0, 0.0 };
        const Vec3 normal_xy { -axis_xy.y, axis_xy.x, 0.0 };
        const double slope = horizontal / std::max(0.1, std::abs(tangent.z));
        const double oval_stretch = std::clamp(slope * 0.22, 0.0, 0.38);
        const double radius = std::max(0.05, radii[segment]);
        const double major = radius * (1.0 + oval_stretch);
        const double minor = std::max(radius * 0.82, radius * (1.0 - oval_stretch * 0.25));

        std::vector<int> ring;
        ring.reserve(std::size_t(safe_ring_segments));
        for (int index = 0; index < safe_ring_segments; ++index) {
            const double angle = 2.0 * kPi * double(index) / double(safe_ring_segments);
            const Vec3 offset = add(
                multiply(axis_xy, std::cos(angle) * major),
                multiply(normal_xy, std::sin(angle) * minor));
            ring.push_back(add_vertex(mesh, { centers[segment].x + offset.x, centers[segment].y + offset.y, centers[segment].z }));
        }
        rings.push_back(std::move(ring));
    }

    for (std::size_t segment = 0; segment + 1 < rings.size(); ++segment) {
        for (int index = 0; index < safe_ring_segments; ++index) {
            const int next = (index + 1) % safe_ring_segments;
            const int a = rings[segment][std::size_t(index)];
            const int b = rings[segment][std::size_t(next)];
            const int c = rings[segment + 1][std::size_t(next)];
            const int d = rings[segment + 1][std::size_t(index)];
            add_indexed_triangle(mesh, a, b, c);
            add_indexed_triangle(mesh, a, c, d);
        }
    }

    const int bottom_center = add_vertex(mesh, centers.front());
    const int top_center = add_vertex(mesh, centers.back());
    for (int index = 0; index < safe_ring_segments; ++index) {
        const int next = (index + 1) % safe_ring_segments;
        add_indexed_triangle(mesh, bottom_center, rings.front()[std::size_t(next)], rings.front()[std::size_t(index)]);
        add_indexed_triangle(mesh, top_center, rings.back()[std::size_t(index)], rings.back()[std::size_t(next)]);
    }
}

struct OrganicNode {
    Vec3 point;
    double load = 1.0;
    double distance_to_top = 0.0;
    double radius = 0.5;
    int source_count = 1;
};

struct OrganicSkeletonEdge {
    int parent_id = 0;
    int child_id = 0;
    int level = 0;
};

void collect_organic_layer_disks(
    OrganicTreeLayerData* layer_data,
    const std::vector<OrganicNode>& nodes,
    const std::vector<OrganicSkeletonEdge>& edges,
    const ContactGrid& grid,
    const double root_z,
    const double top_z,
    const double layer_height)
{
    if (!layer_data || nodes.empty() || edges.empty())
        return;

    double max_radius = 0.0;
    for (const OrganicNode& node : nodes) {
        max_radius = std::max(max_radius, node.radius);
    }

    const double union_cell = std::clamp(std::min(grid.cell_size * 0.42, max_radius * 0.18), 0.18, 0.42);
    const double safe_layer_height = std::max(0.05, layer_height);
    const int layer_count = std::max(1, int(std::ceil((top_z - root_z) / safe_layer_height)) + 2);
    layer_data->bottom_z = root_z;
    layer_data->top_z = top_z;
    layer_data->layer_height = safe_layer_height;
    layer_data->circle_segments = std::max(14, std::min(28, int(std::ceil(max_radius * 5.0))));
    layer_data->layers.clear();
    layer_data->layers.resize(std::size_t(layer_count));

    for (const OrganicSkeletonEdge& edge : edges) {
        if (edge.parent_id < 0 || edge.child_id < 0 ||
            edge.parent_id >= int(nodes.size()) || edge.child_id >= int(nodes.size()))
            continue;
        const OrganicNode& parent = nodes[std::size_t(edge.parent_id)];
        const OrganicNode& child = nodes[std::size_t(edge.child_id)];
        const double z0 = std::min(parent.point.z, child.point.z);
        const double z1 = std::max(parent.point.z, child.point.z);
        if (z1 <= z0 + 1e-6)
            continue;
        const int first_layer = std::max(0, int(std::floor((z0 - root_z) / safe_layer_height)));
        const int last_layer = std::min(layer_count - 1, int(std::ceil((z1 - root_z) / safe_layer_height)));
        for (int layer = first_layer; layer <= last_layer; ++layer) {
            const double z = root_z + double(layer) * safe_layer_height;
            const double t = std::clamp((z - parent.point.z) / (child.point.z - parent.point.z), 0.0, 1.0);
            const Vec3 center {
                parent.point.x + (child.point.x - parent.point.x) * t,
                parent.point.y + (child.point.y - parent.point.y) * t,
                z
            };
            const double radius = std::max(union_cell * 0.85, parent.radius + (child.radius - parent.radius) * t);
            layer_data->layers[std::size_t(layer)].push_back({ center.x, center.y, z, radius });
        }
    }
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

double slope_adaptive_clearance_mm(const ContactGrid& grid, const SupportSettings& settings, const Vec3& normal);

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

void mark_model_side_wall_clearance(ContactGrid& grid, const SupportSettings& settings, const Vec3& a, const Vec3& b, const Vec3& c)
{
    const std::array<Vec3, 3> points { a, b, c };
    int first = 0;
    int second = 1;
    double max_distance = -1.0;

    for (int left = 0; left < 3; ++left) {
        for (int right = left + 1; right < 3; ++right) {
            const double distance = std::hypot(points[left].x - points[right].x, points[left].y - points[right].y);
            if (distance > max_distance) {
                max_distance = distance;
                first = left;
                second = right;
            }
        }
    }

    const Vec3 p0 = points[first];
    const Vec3 p1 = points[second];
    const double side_floor_z = std::min({ a.z, b.z, c.z }) - settings.effective_top_z_distance_mm();
    const double expand = settings.xy_distance_mm + grid.cell_size * 0.8;
    const int min_ix = int(std::floor((std::min(p0.x, p1.x) - expand - grid.origin_x) / grid.cell_size));
    const int max_ix = int(std::floor((std::max(p0.x, p1.x) + expand - grid.origin_x) / grid.cell_size));
    const int min_iy = int(std::floor((std::min(p0.y, p1.y) - expand - grid.origin_y) / grid.cell_size));
    const int max_iy = int(std::floor((std::max(p0.y, p1.y) + expand - grid.origin_y) / grid.cell_size));

    for (int iy = min_iy; iy <= max_iy; ++iy) {
        for (int ix = min_ix; ix <= max_ix; ++ix) {
            if (!grid.inside(ix, iy))
                continue;

            const Vec3 cell_center {
                grid.origin_x + (double(ix) + 0.5) * grid.cell_size,
                grid.origin_y + (double(iy) + 0.5) * grid.cell_size,
                0.0
            };
            const double distance = max_distance > 1e-9
                ? point_segment_distance_xy(cell_center, p0, p1)
                : std::hypot(cell_center.x - p0.x, cell_center.y - p0.y);
            if (distance <= expand)
                mark_model_ceiling_cell(grid, ix, iy, side_floor_z);
        }
    }
}

void populate_model_collision_ceiling(ContactGrid& grid, const MeshStats& mesh_stats, const SupportSettings& settings)
{
    const std::size_t triangle_count = mesh_stats.vertices.size() / 3;
    const unsigned worker_count = support_worker_count(triangle_count);
    if (worker_count <= 1) {
        for (std::size_t vertex_index = 0; vertex_index + 2 < mesh_stats.vertices.size(); vertex_index += 3) {
            const Vec3 a = mesh_stats.vertices[vertex_index];
            const Vec3 b = mesh_stats.vertices[vertex_index + 1];
            const Vec3 c = mesh_stats.vertices[vertex_index + 2];
            if (triangle_area_2d(a, b, c) <= 1e-8) {
                mark_model_side_wall_clearance(grid, settings, a, b, c);
                continue;
            }

            const Vec3 normal = cross(subtract(b, a), subtract(c, a));
            const double adaptive_clearance = slope_adaptive_clearance_mm(grid, settings, normal);
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
                        mark_model_ceiling_cell(grid, ix, iy, sampled_z - settings.effective_top_z_distance_mm() - adaptive_clearance);
                }
            }
        }
        return;
    }

#if CRADLEMAKER_CAN_USE_NATIVE_THREADS
    std::vector<ContactGrid> local_grids;
    local_grids.reserve(worker_count);
    for (unsigned worker = 0; worker < worker_count; ++worker) {
        ContactGrid local;
        local.origin_x = grid.origin_x;
        local.origin_y = grid.origin_y;
        local.cell_size = grid.cell_size;
        local.bottom_z = grid.bottom_z;
        local.cols = grid.cols;
        local.rows = grid.rows;
        local.model_ceiling_z.assign(grid.model_ceiling_z.size(), std::numeric_limits<double>::max());
        local_grids.push_back(std::move(local));
    }

    auto process_range = [&](const unsigned worker, const std::size_t first_triangle, const std::size_t last_triangle) {
        ContactGrid& local_grid = local_grids[worker];
        for (std::size_t triangle_index = first_triangle; triangle_index < last_triangle; ++triangle_index) {
            const std::size_t vertex_index = triangle_index * 3;
            const Vec3 a = mesh_stats.vertices[vertex_index];
            const Vec3 b = mesh_stats.vertices[vertex_index + 1];
            const Vec3 c = mesh_stats.vertices[vertex_index + 2];
            if (triangle_area_2d(a, b, c) <= 1e-8) {
                mark_model_side_wall_clearance(local_grid, settings, a, b, c);
                continue;
            }

            const Vec3 normal = cross(subtract(b, a), subtract(c, a));
            const double adaptive_clearance = slope_adaptive_clearance_mm(local_grid, settings, normal);
            const double expand = local_grid.cell_size * 0.75;
            const int min_ix = int(std::floor((std::min({ a.x, b.x, c.x }) - expand - local_grid.origin_x) / local_grid.cell_size));
            const int max_ix = int(std::floor((std::max({ a.x, b.x, c.x }) + expand - local_grid.origin_x) / local_grid.cell_size));
            const int min_iy = int(std::floor((std::min({ a.y, b.y, c.y }) - expand - local_grid.origin_y) / local_grid.cell_size));
            const int max_iy = int(std::floor((std::max({ a.y, b.y, c.y }) + expand - local_grid.origin_y) / local_grid.cell_size));

            for (int iy = min_iy; iy <= max_iy; ++iy) {
                for (int ix = min_ix; ix <= max_ix; ++ix) {
                    if (!local_grid.inside(ix, iy))
                        continue;

                    double sampled_z = std::numeric_limits<double>::max();
                    if (sample_cell_triangle_z(local_grid, ix, iy, a, b, c, sampled_z))
                        mark_model_ceiling_cell(local_grid, ix, iy, sampled_z - settings.effective_top_z_distance_mm() - adaptive_clearance);
                }
            }
        }
    };

    std::vector<std::thread> workers;
    workers.reserve(worker_count > 0 ? worker_count - 1 : 0);
    const std::size_t chunk = (triangle_count + worker_count - 1) / worker_count;
    for (unsigned worker = 1; worker < worker_count; ++worker) {
        const std::size_t first = std::min<std::size_t>(triangle_count, std::size_t(worker) * chunk);
        const std::size_t last = std::min<std::size_t>(triangle_count, first + chunk);
        workers.emplace_back(process_range, worker, first, last);
    }
    process_range(0, 0, std::min<std::size_t>(triangle_count, chunk));
    for (std::thread& worker : workers)
        worker.join();

    for (const ContactGrid& local_grid : local_grids) {
        for (std::size_t index = 0; index < grid.model_ceiling_z.size(); ++index)
            grid.model_ceiling_z[index] = std::min(grid.model_ceiling_z[index], local_grid.model_ceiling_z[index]);
    }
#endif
}

double clamp_to_model_ceiling(const ContactGrid& grid, const int ix, const int iy, const double top_z)
{
    if (!grid.has_model_ceiling(ix, iy))
        return top_z;

    return std::min(top_z, grid.model_ceiling(ix, iy));
}

double slope_adaptive_clearance_mm(const ContactGrid& grid, const SupportSettings& settings, const Vec3& normal)
{
    const double normal_length = length(normal);
    if (normal_length <= 1e-9)
        return 0.0;

    const double nz = std::abs(normal.z) / normal_length;
    const double nxy = std::sqrt(std::max(0.0, 1.0 - nz * nz));
    if (nxy <= 1e-6)
        return 0.0;

    const double slope = nxy / std::max(0.08, nz);
    const double sample_radius = grid.cell_size * 0.58 + settings.xy_distance_mm * 0.35;
    const double adaptive = slope * sample_radius;
    const double cap = std::max(grid.cell_size * 2.25, settings.xy_distance_mm * 3.0);
    return std::clamp(adaptive, 0.0, cap);
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
    const std::size_t triangle_count = mesh_stats.vertices.size() / 3;
    const unsigned worker_count = support_worker_count(triangle_count);

#if CRADLEMAKER_CAN_USE_NATIVE_THREADS
    if (worker_count > 1) {
        (void)coverage;
        std::vector<ContactGrid> local_grids;
        local_grids.reserve(worker_count);
        for (unsigned worker = 0; worker < worker_count; ++worker) {
            ContactGrid local;
            local.origin_x = grid.origin_x;
            local.origin_y = grid.origin_y;
            local.cell_size = grid.cell_size;
            local.bottom_z = grid.bottom_z;
            local.cols = grid.cols;
            local.rows = grid.rows;
            local.model_ceiling_z = grid.model_ceiling_z;
            local.top_z.assign(grid.top_z.size(), grid.bottom_z);
            local.lower_envelope_z.assign(grid.lower_envelope_z.size(), std::numeric_limits<double>::max());
            local_grids.push_back(std::move(local));
        }

        auto process_range = [&](const unsigned worker, const std::size_t first_triangle, const std::size_t last_triangle) {
            ContactGrid& local_grid = local_grids[worker];
            for (std::size_t triangle_index = first_triangle; triangle_index < last_triangle; ++triangle_index) {
                const std::size_t vertex_index = triangle_index * 3;
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

                const double adaptive_clearance = slope_adaptive_clearance_mm(local_grid, settings, normal);
                const double expand = local_grid.cell_size * 0.9;
                const int min_ix = int(std::floor((std::min({ a.x, b.x, c.x }) - expand - local_grid.origin_x) / local_grid.cell_size));
                const int max_ix = int(std::floor((std::max({ a.x, b.x, c.x }) + expand - local_grid.origin_x) / local_grid.cell_size));
                const int min_iy = int(std::floor((std::min({ a.y, b.y, c.y }) - expand - local_grid.origin_y) / local_grid.cell_size));
                const int max_iy = int(std::floor((std::max({ a.y, b.y, c.y }) + expand - local_grid.origin_y) / local_grid.cell_size));

                for (int iy = min_iy; iy <= max_iy; ++iy) {
                    for (int ix = min_ix; ix <= max_ix; ++ix) {
                        double model_z = 0.0;
                        if (!sample_cell_triangle_z(local_grid, ix, iy, a, b, c, model_z))
                            continue;

                        const double top_z = std::max(local_grid.bottom_z, model_z - settings.effective_top_z_distance_mm() - adaptive_clearance);
                        if (local_grid.has_model_ceiling(ix, iy) && top_z > local_grid.model_ceiling(ix, iy) + local_grid.cell_size * 0.1)
                            continue;
                        if (top_z <= local_grid.bottom_z + 0.05)
                            continue;
                        mark_lower_envelope_target_cell(local_grid, ix, iy, top_z);
                        mark_lower_envelope_cell(local_grid, ix, iy, top_z);
                    }
                }
            }
        };

        std::vector<std::thread> workers;
        workers.reserve(worker_count > 0 ? worker_count - 1 : 0);
        const std::size_t chunk = (triangle_count + worker_count - 1) / worker_count;
        for (unsigned worker = 1; worker < worker_count; ++worker) {
            const std::size_t first = std::min<std::size_t>(triangle_count, std::size_t(worker) * chunk);
            const std::size_t last = std::min<std::size_t>(triangle_count, first + chunk);
            workers.emplace_back(process_range, worker, first, last);
        }
        process_range(0, 0, std::min<std::size_t>(triangle_count, chunk));
        for (std::thread& worker : workers)
            worker.join();

        for (const ContactGrid& local_grid : local_grids) {
            for (std::size_t index = 0; index < grid.top_z.size(); ++index) {
                if (local_grid.lower_envelope_z[index] < grid.lower_envelope_z[index])
                    grid.lower_envelope_z[index] = local_grid.lower_envelope_z[index];

                if (local_grid.top_z[index] <= grid.bottom_z + 0.05)
                    continue;
                if (grid.top_z[index] <= grid.bottom_z + 0.05 || local_grid.top_z[index] < grid.top_z[index])
                    grid.top_z[index] = local_grid.top_z[index];
            }
        }

        for (std::size_t index = 0; index < grid.lower_envelope_z.size(); ++index) {
            if (grid.lower_envelope_z[index] < std::numeric_limits<double>::max() * 0.5 &&
                grid.top_z[index] > grid.bottom_z + 0.05) {
                ++marked_cells;
            }
        }
        return marked_cells;
    }
#else
    (void)worker_count;
#endif

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

        const double adaptive_clearance = slope_adaptive_clearance_mm(grid, settings, normal);
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

                const double top_z = std::max(grid.bottom_z, model_z - settings.effective_top_z_distance_mm() - adaptive_clearance);
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

std::size_t mark_manual_support(ContactGrid& grid, const ManualSupportPoint& support, const SupportSettings& settings)
{
    const Vec3& point = support.point;
    const double radius = std::clamp(support.radius > 0.0 ? support.radius : settings.manual_contact_radius_mm, grid.cell_size, 50.0);
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

std::size_t remove_manual_support(ContactGrid& grid, const ManualSupportPoint& support, const SupportSettings& settings)
{
    const Vec3& point = support.point;
    const double radius = std::clamp(support.radius > 0.0 ? support.radius : settings.manual_contact_radius_mm, grid.cell_size, 50.0);
    const int min_ix = int(std::floor((point.x - radius - grid.origin_x) / grid.cell_size));
    const int max_ix = int(std::floor((point.x + radius - grid.origin_x) / grid.cell_size));
    const int min_iy = int(std::floor((point.y - radius - grid.origin_y) / grid.cell_size));
    const int max_iy = int(std::floor((point.y + radius - grid.origin_y) / grid.cell_size));
    std::size_t removed_cells = 0;

    for (int iy = min_iy; iy <= max_iy; ++iy) {
        for (int ix = min_ix; ix <= max_ix; ++ix) {
            if (!grid.inside(ix, iy))
                continue;
            const double cx = grid.origin_x + (double(ix) + 0.5) * grid.cell_size;
            const double cy = grid.origin_y + (double(iy) + 0.5) * grid.cell_size;
            if (std::hypot(cx - point.x, cy - point.y) > radius)
                continue;

            const int cell_index = grid.index(ix, iy);
            if (grid.top_z[cell_index] > grid.bottom_z + 0.05)
                ++removed_cells;
            grid.top_z[cell_index] = grid.bottom_z;
            grid.lower_envelope_z[cell_index] = std::numeric_limits<double>::max();
        }
    }

    return removed_cells;
}

std::vector<unsigned char> build_manual_blocker_mask(
    const ContactGrid& grid,
    const std::vector<ManualSupportPoint>& manual_points,
    const SupportSettings& settings,
    std::size_t* active_blockers = nullptr)
{
    std::vector<unsigned char> mask(grid.top_z.size(), 0);
    std::size_t blockers = 0;

    for (const ManualSupportPoint& support : manual_points) {
        if (!support.blocker)
            continue;

        const Vec3& point = support.point;
        const double radius = std::clamp(
            (support.radius > 0.0 ? support.radius : settings.manual_contact_radius_mm) + grid.cell_size * 0.75,
            grid.cell_size,
            60.0
        );
        const int min_ix = int(std::floor((point.x - radius - grid.origin_x) / grid.cell_size));
        const int max_ix = int(std::floor((point.x + radius - grid.origin_x) / grid.cell_size));
        const int min_iy = int(std::floor((point.y - radius - grid.origin_y) / grid.cell_size));
        const int max_iy = int(std::floor((point.y + radius - grid.origin_y) / grid.cell_size));
        bool touched_grid = false;

        for (int iy = min_iy; iy <= max_iy; ++iy) {
            for (int ix = min_ix; ix <= max_ix; ++ix) {
                if (!grid.inside(ix, iy))
                    continue;

                const double cx = grid.origin_x + (double(ix) + 0.5) * grid.cell_size;
                const double cy = grid.origin_y + (double(iy) + 0.5) * grid.cell_size;
                if (std::hypot(cx - point.x, cy - point.y) > radius)
                    continue;

                mask[grid.index(ix, iy)] = 1;
                touched_grid = true;
            }
        }

        if (touched_grid)
            ++blockers;
    }

    if (active_blockers)
        *active_blockers = blockers;
    return mask;
}

std::size_t apply_manual_blocker_mask(ContactGrid& grid, const std::vector<unsigned char>& mask, const double allowed_top_z)
{
    if (mask.empty())
        return 0;

    const double clamped_allowed_top = std::max(grid.bottom_z, allowed_top_z);
    std::size_t removed_cells = 0;
    const std::size_t count = std::min(mask.size(), grid.top_z.size());
    for (std::size_t index = 0; index < count; ++index) {
        if (!mask[index])
            continue;

        if (grid.top_z[index] > clamped_allowed_top + 0.05)
            ++removed_cells;
        grid.top_z[index] = std::min(grid.top_z[index], clamped_allowed_top);
        grid.lower_envelope_z[index] = std::numeric_limits<double>::max();
    }

    return removed_cells;
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

std::size_t join_bottom_uprights(ContactGrid& grid, const double base_thickness_mm)
{
    if (base_thickness_mm <= grid.bottom_z + 0.05)
        return 0;

    const std::vector<double> source = grid.top_z;
    auto source_occupied = [&](const int ix, const int iy) {
        return grid.inside(ix, iy) && source[grid.index(ix, iy)] > grid.bottom_z + 0.05;
    };

    std::vector<unsigned char> join_mask(grid.top_z.size(), 0);

    for (int iy = 0; iy < grid.rows; ++iy) {
        int min_ix = grid.cols;
        int max_ix = -1;
        for (int ix = 0; ix < grid.cols; ++ix) {
            if (!source_occupied(ix, iy))
                continue;
            min_ix = std::min(min_ix, ix);
            max_ix = std::max(max_ix, ix);
        }
        if (max_ix < min_ix)
            continue;
        for (int ix = min_ix; ix <= max_ix; ++ix)
            join_mask[grid.index(ix, iy)] = 1;
    }

    for (int ix = 0; ix < grid.cols; ++ix) {
        int min_iy = grid.rows;
        int max_iy = -1;
        for (int iy = 0; iy < grid.rows; ++iy) {
            if (!source_occupied(ix, iy))
                continue;
            min_iy = std::min(min_iy, iy);
            max_iy = std::max(max_iy, iy);
        }
        if (max_iy < min_iy)
            continue;
        for (int iy = min_iy; iy <= max_iy; ++iy)
            join_mask[grid.index(ix, iy)] = 1;
    }

    std::size_t joined_cells = 0;
    for (int iy = 0; iy < grid.rows; ++iy) {
        for (int ix = 0; ix < grid.cols; ++ix) {
            const int cell_index = grid.index(ix, iy);
            if (!join_mask[cell_index])
                continue;

            const double clamped_base_top = clamp_to_model_ceiling(grid, ix, iy, base_thickness_mm);
            if (clamped_base_top <= grid.bottom_z + 0.05)
                continue;

            double& cell_top = grid.top_z[cell_index];
            if (cell_top < clamped_base_top - 0.05) {
                if (cell_top <= grid.bottom_z + 0.05)
                    ++joined_cells;
                cell_top = clamped_base_top;
            }
        }
    }

    return joined_cells;
}

double column_component_threshold(const ContactGrid& grid, const SupportSettings& settings)
{
    const double base_top = settings.base_enabled ? settings.base_thickness_mm : grid.bottom_z;
    return base_top + std::max(0.15, grid.cell_size * 0.25);
}

std::size_t count_column_components(const ContactGrid& grid, const SupportSettings& settings)
{
    const double min_column_top = column_component_threshold(grid, settings);
    std::vector<unsigned char> visited(grid.top_z.size(), 0);
    std::vector<int> stack;
    stack.reserve(256);
    std::size_t components = 0;

    auto is_column = [&](const int ix, const int iy) {
        return grid.inside(ix, iy) && grid.top_z[grid.index(ix, iy)] > min_column_top;
    };

    for (int iy = 0; iy < grid.rows; ++iy) {
        for (int ix = 0; ix < grid.cols; ++ix) {
            const int start_index = grid.index(ix, iy);
            if (visited[start_index] || !is_column(ix, iy))
                continue;

            ++components;
            visited[start_index] = 1;
            stack.push_back(start_index);

            while (!stack.empty()) {
                const int cell_index = stack.back();
                stack.pop_back();
                const int cell_x = cell_index % grid.cols;
                const int cell_y = cell_index / grid.cols;

                constexpr std::array<std::array<int, 2>, 4> neighbors {{
                    {{ -1, 0 }},
                    {{ 1, 0 }},
                    {{ 0, -1 }},
                    {{ 0, 1 }}
                }};

                for (const auto& offset : neighbors) {
                    const int nx = cell_x + offset[0];
                    const int ny = cell_y + offset[1];
                    if (!grid.inside(nx, ny))
                        continue;
                    const int neighbor_index = grid.index(nx, ny);
                    if (visited[neighbor_index] || !is_column(nx, ny))
                        continue;
                    visited[neighbor_index] = 1;
                    stack.push_back(neighbor_index);
                }
            }
        }
    }

    return components;
}

std::size_t merge_nearby_columns(ContactGrid& grid, const SupportSettings& settings)
{
    if (!settings.merge_nearby_columns_enabled || settings.tree_mode)
        return 0;

    const double base_top = settings.base_enabled ? settings.base_thickness_mm : grid.bottom_z;
    const double min_column_top = column_component_threshold(grid, settings);
    const double merge_ceiling_clearance = std::max(0.2, grid.cell_size * 0.25);
    const double merge_radius_mm = std::clamp(settings.contact_cell_size_mm * 18.0, 8.0, 22.0);
    const int merge_radius_cells = std::max(1, int(std::ceil(merge_radius_mm / grid.cell_size)));
    const std::vector<double> source = grid.top_z;
    std::vector<double> candidate = grid.top_z;
    std::size_t merged_cells = 0;

    auto source_column = [&](const int ix, const int iy) {
        return grid.inside(ix, iy) && source[grid.index(ix, iy)] > min_column_top;
    };

    auto safe_merge_top = [&](const int ix, const int iy, const double desired_top) {
        if (!grid.inside(ix, iy))
            return grid.bottom_z;
        if (!grid.has_model_ceiling(ix, iy))
            return desired_top;
        return std::min(desired_top, grid.model_ceiling(ix, iy) - merge_ceiling_clearance);
    };

    auto ray_hit_top = [&](const int ix, const int iy, const int dx, const int dy) {
        double hit_top = grid.bottom_z;
        for (int step = 1; step <= merge_radius_cells; ++step) {
            const int nx = ix + dx * step;
            const int ny = iy + dy * step;
            if (!grid.inside(nx, ny))
                break;
            if (!source_column(nx, ny))
                continue;
            hit_top = source[grid.index(nx, ny)];
            break;
        }
        return hit_top;
    };

    auto paired_bridge_top = [&](const int ix, const int iy, const int dx, const int dy) {
        const double forward = ray_hit_top(ix, iy, dx, dy);
        if (forward <= min_column_top)
            return grid.bottom_z;
        const double backward = ray_hit_top(ix, iy, -dx, -dy);
        if (backward <= min_column_top)
            return grid.bottom_z;
        return std::min(forward, backward);
    };

    constexpr std::array<std::array<int, 2>, 4> bridge_axes {{
        {{ 1, 0 }},
        {{ 0, 1 }},
        {{ 1, 1 }},
        {{ 1, -1 }}
    }};

    for (int iy = 0; iy < grid.rows; ++iy) {
        for (int ix = 0; ix < grid.cols; ++ix) {
            const int cell_index = grid.index(ix, iy);
            if (source[cell_index] > min_column_top)
                continue;

            double best_top = grid.bottom_z;
            for (const auto& axis : bridge_axes) {
                const double bridge_top = paired_bridge_top(ix, iy, axis[0], axis[1]);
                if (bridge_top > best_top)
                    best_top = bridge_top;
            }

            const double clamped_top = safe_merge_top(ix, iy, best_top);
            if (clamped_top <= min_column_top)
                continue;
            candidate[cell_index] = std::max(candidate[cell_index], clamped_top);
        }
    }

    for (std::size_t index = 0; index < grid.top_z.size(); ++index) {
        if (candidate[index] <= grid.top_z[index] + 0.05)
            continue;
        grid.top_z[index] = candidate[index];
        ++merged_cells;
    }

    return merged_cells;
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

double layer_corner_value(
    const ContactGrid& grid,
    const std::vector<double>& bottom_z,
    const std::vector<double>& top_z,
    const std::vector<double>& value_z,
    const int corner_ix,
    const int corner_iy,
    const double shoulder_z,
    const bool prefer_high,
    const double fallback)
{
    double value = prefer_high ? std::numeric_limits<double>::lowest() : std::numeric_limits<double>::max();
    bool found = false;
    const bool ignore_shoulder_neighbors = shoulder_z > grid.bottom_z + 0.05 && fallback > shoulder_z + grid.cell_size * 0.5;

    for (int dy = -1; dy <= 0; ++dy) {
        for (int dx = -1; dx <= 0; ++dx) {
            const int ix = corner_ix + dx;
            const int iy = corner_iy + dy;
            if (!layer_cell_occupied(grid, bottom_z, top_z, ix, iy))
                continue;

            const double candidate = value_z[grid.index(ix, iy)];
            if (ignore_shoulder_neighbors && candidate <= shoulder_z + 0.05)
                continue;

            value = prefer_high ? std::max(value, candidate) : std::min(value, candidate);
            found = true;
        }
    }

    return found ? value : fallback;
}

double corner_model_ceiling(const ContactGrid& grid, const int corner_ix, const int corner_iy, const double fallback)
{
    double ceiling = fallback;
    bool found = false;

    for (int dy = -1; dy <= 0; ++dy) {
        for (int dx = -1; dx <= 0; ++dx) {
            const int ix = corner_ix + dx;
            const int iy = corner_iy + dy;
            if (!grid.has_model_ceiling(ix, iy))
                continue;

            const double candidate = grid.model_ceiling(ix, iy);
            // Corners are shared by neighboring cells. Use the highest nearby
            // ceiling so a valid tall contact cell is not crushed by a lower
            // side-wall/base neighbor that merely touches the same corner.
            ceiling = found ? std::max(ceiling, candidate) : candidate;
            found = true;
        }
    }

    return found ? ceiling : fallback;
}

double clamp_corner_to_model_ceiling(const ContactGrid& grid, const int corner_ix, const int corner_iy, const double top_z)
{
    return std::min(top_z, corner_model_ceiling(grid, corner_ix, corner_iy, top_z));
}

void add_cell_top_terrain(
    SupportMesh& out,
    const double x0,
    const double x1,
    const double y0,
    const double y1,
    const double center_z,
    const double z00,
    const double z10,
    const double z11,
    const double z01)
{
    (void)center_z;
    add_quad(out, { x0, y0, z00 }, { x1, y0, z10 }, { x1, y1, z11 }, { x0, y1, z01 });
}

void add_cell_bottom_terrain(
    SupportMesh& out,
    const double x0,
    const double x1,
    const double y0,
    const double y1,
    const double z00,
    const double z10,
    const double z11,
    const double z01)
{
    const Vec3 p00 { x0, y0, z00 };
    const Vec3 p10 { x1, y0, z10 };
    const Vec3 p11 { x1, y1, z11 };
    const Vec3 p01 { x0, y1, z01 };

    add_quad(out, p01, p11, p10, p00);
}

void add_cell_boundary_side_terrain(
    SupportMesh& out,
    const int dx,
    const int dy,
    const double x0,
    const double x1,
    const double y0,
    const double y1,
    const double b00,
    const double b10,
    const double b11,
    const double b01,
    const double t00,
    const double t10,
    const double t11,
    const double t01)
{
    if (dx < 0)
        add_quad(out, { x0, y1, b01 }, { x0, y0, b00 }, { x0, y0, t00 }, { x0, y1, t01 });
    else if (dx > 0)
        add_quad(out, { x1, y0, b10 }, { x1, y1, b11 }, { x1, y1, t11 }, { x1, y0, t10 });
    else if (dy < 0)
        add_quad(out, { x0, y0, b00 }, { x1, y0, b10 }, { x1, y0, t10 }, { x0, y0, t00 });
    else
        add_quad(out, { x1, y1, b11 }, { x0, y1, b01 }, { x0, y1, t01 }, { x1, y1, t11 });
}

void mesh_height_field(const ContactGrid& grid, const std::vector<double>& bottom_z, const std::vector<double>& top_z, const double shoulder_z, SupportMesh& out)
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

            const double top00 = clamp_corner_to_model_ceiling(grid, ix, iy, layer_corner_value(grid, bottom_z, top_z, top_z, ix, iy, shoulder_z, true, z1));
            const double top10 = clamp_corner_to_model_ceiling(grid, ix + 1, iy, layer_corner_value(grid, bottom_z, top_z, top_z, ix + 1, iy, shoulder_z, true, z1));
            const double top11 = clamp_corner_to_model_ceiling(grid, ix + 1, iy + 1, layer_corner_value(grid, bottom_z, top_z, top_z, ix + 1, iy + 1, shoulder_z, true, z1));
            const double top01 = clamp_corner_to_model_ceiling(grid, ix, iy + 1, layer_corner_value(grid, bottom_z, top_z, top_z, ix, iy + 1, shoulder_z, true, z1));
            const double bottom00 = layer_corner_value(grid, bottom_z, top_z, bottom_z, ix, iy, 0.0, false, z0);
            const double bottom10 = layer_corner_value(grid, bottom_z, top_z, bottom_z, ix + 1, iy, 0.0, false, z0);
            const double bottom11 = layer_corner_value(grid, bottom_z, top_z, bottom_z, ix + 1, iy + 1, 0.0, false, z0);
            const double bottom01 = layer_corner_value(grid, bottom_z, top_z, bottom_z, ix, iy + 1, 0.0, false, z0);

            add_cell_top_terrain(out, x0, x1, y0, y1, z1, top00, top10, top11, top01);
            add_cell_bottom_terrain(out, x0, x1, y0, y1, bottom00, bottom10, bottom11, bottom01);

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
                    add_cell_boundary_side_terrain(
                        out,
                        neighbor[0],
                        neighbor[1],
                        x0,
                        x1,
                        y0,
                        y1,
                        bottom00,
                        bottom10,
                        bottom11,
                        bottom01,
                        top00,
                        top10,
                        top11,
                        top01);
                }
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

struct TreeTip {
    int ix = 0;
    int iy = 0;
    Vec3 point;
};

struct TreeCluster {
    std::vector<int> tips;
    Vec3 center;
};

struct TreeRouteResult {
    bool emitted = false;
    bool used_local_upright = false;
    bool used_waypoint = false;
    bool slope_reroute = false;
    bool model_reroute = false;
};

struct TreeMeshResult {
    std::size_t branches = 0;
    std::size_t tip_contacts = 0;
    std::size_t local_uprights = 0;
    std::size_t waypoint_branches = 0;
    std::size_t slope_reroutes = 0;
    std::size_t model_reroutes = 0;
};

double distance_xy(const Vec3& lhs, const Vec3& rhs)
{
    return std::hypot(lhs.x - rhs.x, lhs.y - rhs.y);
}

std::vector<TreeTip> collect_tree_tips(
    const ContactGrid& grid,
    const std::vector<double>& support_top,
    const std::vector<unsigned char>& contact_mask,
    const double root_z,
    const double sample_spacing)
{
    std::vector<TreeTip> tips;
    const int stride = std::max(1, int(std::ceil(sample_spacing / std::max(grid.cell_size, 0.05))));
    for (int block_y = 0; block_y < grid.rows; block_y += stride) {
        for (int block_x = 0; block_x < grid.cols; block_x += stride) {
            int best_ix = -1;
            int best_iy = -1;
            double best_z = root_z;
            for (int iy = block_y; iy < std::min(grid.rows, block_y + stride); ++iy) {
                for (int ix = block_x; ix < std::min(grid.cols, block_x + stride); ++ix) {
                    const int cell_index = grid.index(ix, iy);
                    if (cell_index >= int(contact_mask.size()) || !contact_mask[std::size_t(cell_index)])
                        continue;
                    const double z = support_top[std::size_t(cell_index)];
                    if (z <= root_z + 0.25)
                        continue;
                    if (best_ix < 0 || z > best_z) {
                        best_ix = ix;
                        best_iy = iy;
                        best_z = z;
                    }
                }
            }
            if (best_ix >= 0) {
                tips.push_back({
                    best_ix,
                    best_iy,
                    {
                        grid.origin_x + (double(best_ix) + 0.5) * grid.cell_size,
                        grid.origin_y + (double(best_iy) + 0.5) * grid.cell_size,
                        best_z
                    }
                });
            }
        }
    }
    return tips;
}

std::vector<TreeCluster> cluster_tree_tips(const std::vector<TreeTip>& tips, const double cluster_radius)
{
    std::vector<TreeCluster> clusters;
    for (int tip_index = 0; tip_index < int(tips.size()); ++tip_index) {
        int best_index = -1;
        double best_distance = cluster_radius;
        for (int cluster_index = 0; cluster_index < int(clusters.size()); ++cluster_index) {
            const double distance = distance_xy(tips[std::size_t(tip_index)].point, clusters[std::size_t(cluster_index)].center);
            if (distance < best_distance) {
                best_distance = distance;
                best_index = cluster_index;
            }
        }

        if (best_index < 0) {
            clusters.push_back({ { tip_index }, tips[std::size_t(tip_index)].point });
            continue;
        }

        TreeCluster& cluster = clusters[std::size_t(best_index)];
        cluster.tips.push_back(tip_index);
        Vec3 sum { 0.0, 0.0, 0.0 };
        for (const int member : cluster.tips)
            sum = add(sum, tips[std::size_t(member)].point);
        cluster.center = multiply(sum, 1.0 / double(cluster.tips.size()));
    }
    return clusters;
}

std::vector<OrganicNode> cluster_nodes(const std::vector<OrganicNode>& nodes, const double cluster_radius)
{
    std::vector<OrganicNode> clusters;
    for (const OrganicNode& node : nodes) {
        int best_index = -1;
        double best_distance = cluster_radius;
        for (int cluster_index = 0; cluster_index < int(clusters.size()); ++cluster_index) {
            const double distance = distance_xy(node.point, clusters[std::size_t(cluster_index)].point);
            if (distance < best_distance) {
                best_distance = distance;
                best_index = cluster_index;
            }
        }

        if (best_index < 0) {
        clusters.push_back(node);
            continue;
        }

        OrganicNode& cluster = clusters[std::size_t(best_index)];
        const double combined_load = cluster.load + node.load;
        cluster.point = {
            (cluster.point.x * cluster.load + node.point.x * node.load) / combined_load,
            (cluster.point.y * cluster.load + node.point.y * node.load) / combined_load,
            std::min(cluster.point.z, node.point.z),
        };
        cluster.load = combined_load;
        cluster.distance_to_top = std::max(cluster.distance_to_top, node.distance_to_top);
        cluster.radius = std::max(cluster.radius, node.radius);
        cluster.source_count += node.source_count;
    }
    return clusters;
}

Vec3 branch_node_for_cluster(const TreeCluster& cluster, const std::vector<TreeTip>& tips, const SupportSettings& settings, const double root_z)
{
    double min_top_z = std::numeric_limits<double>::max();
    double max_distance = 0.0;
    for (const int tip_index : cluster.tips) {
        const Vec3& point = tips[std::size_t(tip_index)].point;
        min_top_z = std::min(min_top_z, point.z);
        max_distance = std::max(max_distance, distance_xy(point, cluster.center));
    }

    const double branch_angle = settings.tree_branch_angle_deg * kPi / 180.0;
    const double required_drop = max_distance / std::max(std::tan(branch_angle), 0.05);
    const double branch_drop = std::max(settings.tree_tip_diameter_mm * 1.5, required_drop + settings.tree_tip_diameter_mm);
    const double node_z = std::max(root_z + settings.tree_branch_diameter_mm * 0.75, min_top_z - branch_drop);
    return { cluster.center.x, cluster.center.y, std::min(node_z, min_top_z - 0.2) };
}

double organic_radius_for_load(const SupportSettings& settings, const double load, const double vertical_drop)
{
    const double tip_radius = std::max(0.2, settings.tree_tip_diameter_mm * 0.5);
    const double branch_radius = std::max(tip_radius, settings.tree_branch_diameter_mm * 0.5);
    const double load_radius = tip_radius + std::sqrt(std::max(1.0, load)) * settings.contact_cell_size_mm * 0.18;
    const double taper_radius = tip_radius + std::max(0.0, vertical_drop) * std::tan(7.0 * kPi / 180.0);
    return std::min(branch_radius * 1.8, std::max({ tip_radius, load_radius, std::min(branch_radius, taper_radius) }));
}

double organic_radius_for_distance(const SupportSettings& settings, const double distance_to_top, const double load)
{
    const double tip_radius = std::max(0.2, settings.tree_tip_diameter_mm * 0.5);
    const double branch_radius = std::max(tip_radius, settings.tree_branch_diameter_mm * 0.5);
    const double diameter_angle = 7.0 * kPi / 180.0;
    const double distance_radius = tip_radius * 0.62 + std::max(0.0, distance_to_top) * std::tan(diameter_angle);
    const double load_radius = tip_radius * 0.62 + std::sqrt(std::max(1.0, load)) * settings.contact_cell_size_mm * 0.11;
    return std::clamp(std::max(distance_radius, load_radius), tip_radius * 0.38, branch_radius * 1.55);
}

double legal_parent_z(const Vec3& child, const Vec3& parent_xy, const SupportSettings& settings, const double root_z, const double min_drop)
{
    const double angle = std::clamp(settings.tree_branch_angle_deg, 15.0, 80.0) * kPi / 180.0;
    const double horizontal = distance_xy(child, parent_xy);
    const double required_drop = horizontal / std::max(std::tan(angle), 0.1);
    return std::max(root_z, child.z - std::max(min_drop, required_drop + settings.interface_layer_height_mm));
}

Vec3 weighted_center(const std::vector<OrganicNode>& nodes)
{
    Vec3 sum { 0.0, 0.0, 0.0 };
    double load = 0.0;
    for (const OrganicNode& node : nodes) {
        sum = add(sum, multiply(node.point, node.load));
        load += node.load;
    }
    if (load <= 0.0)
        return {};
    return multiply(sum, 1.0 / load);
}

double deterministic_unit_noise(const int a, const int b, const int salt)
{
    const double value = std::sin(double(a) * 12.9898 + double(b) * 78.233 + double(salt) * 37.719) * 43758.5453123;
    return (value - std::floor(value)) * 2.0 - 1.0;
}

void add_branch_pad(SupportMesh& mesh, const Vec3& center, const double radius, const double thickness, const int segments = 18)
{
    const double r = std::max(0.15, radius);
    const double z0 = center.z;
    const double z1 = center.z + std::max(0.05, thickness);
    std::vector<Vec3> bottom;
    std::vector<Vec3> top;
    bottom.reserve(std::size_t(segments));
    top.reserve(std::size_t(segments));
    for (int index = 0; index < segments; ++index) {
        const double angle = 2.0 * kPi * double(index) / double(segments);
        const double x = center.x + std::cos(angle) * r;
        const double y = center.y + std::sin(angle) * r;
        bottom.push_back({ x, y, z0 });
        top.push_back({ x, y, z1 });
    }

    const Vec3 bottom_center { center.x, center.y, z0 };
    const Vec3 top_center { center.x, center.y, z1 };
    for (int index = 0; index < segments; ++index) {
        const int next = (index + 1) % segments;
        add_quad(mesh, bottom[std::size_t(index)], bottom[std::size_t(next)], top[std::size_t(next)], top[std::size_t(index)]);
        add_triangle(mesh, bottom_center, bottom[std::size_t(next)], bottom[std::size_t(index)]);
        add_triangle(mesh, top_center, top[std::size_t(index)], top[std::size_t(next)]);
    }
}

int grid_ix_for_x(const ContactGrid& grid, const double x)
{
    return int(std::floor((x - grid.origin_x) / grid.cell_size));
}

int grid_iy_for_y(const ContactGrid& grid, const double y)
{
    return int(std::floor((y - grid.origin_y) / grid.cell_size));
}

double model_limited_radius(const ContactGrid& grid, const Vec3& point, const double requested_radius)
{
    const int ix = grid_ix_for_x(grid, point.x);
    const int iy = grid_iy_for_y(grid, point.y);
    if (!grid.inside(ix, iy) || !grid.has_model_ceiling(ix, iy))
        return requested_radius;

    const double ceiling_limited_radius = grid.model_ceiling(ix, iy) - point.z - 0.08;
    if (ceiling_limited_radius <= 0.05)
        return std::min(requested_radius, 0.05);

    return std::min(requested_radius, ceiling_limited_radius);
}

bool branch_point_clear_of_model(const ContactGrid& grid, const Vec3& point, const double radius)
{
    const int ix = grid_ix_for_x(grid, point.x);
    const int iy = grid_iy_for_y(grid, point.y);
    if (!grid.inside(ix, iy) || !grid.has_model_ceiling(ix, iy))
        return true;

    return point.z + radius <= grid.model_ceiling(ix, iy) - 0.04;
}

bool branch_segment_clear_of_model(
    const ContactGrid& grid,
    const Vec3& start,
    const Vec3& end,
    const double start_radius,
    const double end_radius)
{
    const double segment_length = length(subtract(end, start));
    const int samples = std::max(8, int(std::ceil(segment_length / std::max(grid.cell_size * 0.65, 0.25))));
    for (int index = 0; index <= samples; ++index) {
        const double t = double(index) / double(samples);
        const Vec3 point {
            start.x + (end.x - start.x) * t,
            start.y + (end.y - start.y) * t,
            start.z + (end.z - start.z) * t,
        };
        const double radius = start_radius + (end_radius - start_radius) * t;
        if (!branch_point_clear_of_model(grid, point, radius))
            return false;
    }
    return true;
}

bool branch_segment_clear_of_model(const ContactGrid& grid, const Vec3& start, const Vec3& end, const double radius)
{
    return branch_segment_clear_of_model(grid, start, end, radius, radius);
}

bool branch_segment_printable(const Vec3& start, const Vec3& end, const SupportSettings& settings)
{
    const double dz = end.z - start.z;
    if (dz <= 0.08)
        return distance_xy(start, end) <= 0.15;

    const double angle = std::clamp(settings.tree_branch_angle_deg, 15.0, 70.0) * kPi / 180.0;
    return distance_xy(start, end) <= dz * std::tan(angle) + 0.05;
}

Vec3 local_root_for_child(const Vec3& child, const double root_z)
{
    return { child.x, child.y, root_z };
}

bool choose_avoidance_waypoint(
    const ContactGrid& grid,
    const SupportSettings& settings,
    const Vec3& start,
    const Vec3& end,
    const double radius,
    Vec3& waypoint)
{
    const Vec3 delta = subtract(end, start);
    const double horizontal = std::hypot(delta.x, delta.y);
    if (horizontal <= 0.1)
        return false;

    const Vec3 normal { -delta.y / horizontal, delta.x / horizontal, 0.0 };
    const Vec3 midpoint {
        (start.x + end.x) * 0.5,
        (start.y + end.y) * 0.5,
        (start.z + end.z) * 0.5,
    };
    const double base_offset = std::max(settings.xy_distance_mm + radius + grid.cell_size, grid.cell_size * 2.0);
    for (int step = 1; step <= 8; ++step) {
        for (const double side : { -1.0, 1.0 }) {
            Vec3 candidate {
                midpoint.x + normal.x * base_offset * double(step) * side,
                midpoint.y + normal.y * base_offset * double(step) * side,
                midpoint.z,
            };
            if (!branch_point_clear_of_model(grid, candidate, radius))
                continue;
            if (!branch_segment_printable(start, candidate, settings) || !branch_segment_printable(candidate, end, settings))
                continue;
            if (!branch_segment_clear_of_model(grid, start, candidate, radius) || !branch_segment_clear_of_model(grid, candidate, end, radius))
                continue;
            waypoint = candidate;
            return true;
        }
    }

    return false;
}

MeshStats mesh_stats_from_vertex_values(const std::vector<float>& values)
{
    MeshStats stats;
    stats.vertex_values = values.size();
    stats.vertex_count = stats.vertex_values / 3;
    stats.triangle_count = stats.vertex_count / 3;
    stats.vertices.reserve(stats.vertex_count);

    for (std::size_t index = 0; index + 2 < values.size(); index += 3) {
        const Vec3 vertex {
            static_cast<double>(values[index]),
            static_cast<double>(values[index + 1]),
            static_cast<double>(values[index + 2])
        };
        stats.min_x = std::min(stats.min_x, vertex.x);
        stats.max_x = std::max(stats.max_x, vertex.x);
        stats.min_y = std::min(stats.min_y, vertex.y);
        stats.max_y = std::max(stats.max_y, vertex.y);
        stats.min_z = std::min(stats.min_z, vertex.z);
        stats.max_z = std::max(stats.max_z, vertex.z);
        stats.vertices.push_back(vertex);
    }

    return stats;
}

TreeRouteResult add_printable_organic_branch(
    SupportMesh& mesh,
    const ContactGrid& grid,
    const SupportSettings& settings,
    Vec3 start,
    const Vec3& end,
    const double start_radius,
    const double end_radius,
    const double root_z,
    const int curve_segments,
    const int ring_segments)
{
    TreeRouteResult result;
    const double radius = std::max(start_radius, end_radius);
    double effective_start_radius = start_radius;
    double effective_end_radius = end_radius;
    if (!branch_segment_printable(start, end, settings)) {
        result.slope_reroute = true;
        result.used_local_upright = true;
        start = local_root_for_child(end, root_z);
        effective_start_radius = std::min(start_radius, std::max(end_radius * 1.12, settings.tree_tip_diameter_mm * 0.42));
        effective_end_radius = std::min(end_radius, effective_start_radius * 1.05);
        add_branch_pad(mesh, start, std::max(effective_start_radius * 1.05, settings.tree_tip_diameter_mm * 0.5), std::max(0.2, settings.interface_layer_height_mm * 1.5), 14);
    }

    if (branch_segment_clear_of_model(grid, start, end, effective_start_radius, effective_end_radius)) {
        add_layer_area_branch(mesh, start, end, effective_start_radius, effective_end_radius, curve_segments, ring_segments);
        result.emitted = true;
        return result;
    }

    Vec3 waypoint;
    if (choose_avoidance_waypoint(grid, settings, start, end, radius, waypoint)) {
        const double mid_radius = (start_radius + end_radius) * 0.5;
        add_layer_area_branch(mesh, start, waypoint, start_radius, mid_radius, std::max(2, curve_segments / 2), ring_segments);
        add_layer_area_branch(mesh, waypoint, end, mid_radius, end_radius, std::max(2, curve_segments / 2), ring_segments);
        result.emitted = true;
        result.used_waypoint = true;
        result.model_reroute = true;
        return result;
    }

    result.model_reroute = true;
    result.used_local_upright = true;
    start = local_root_for_child(end, root_z);
    effective_start_radius = std::min(start_radius, std::max(end_radius * 1.12, settings.tree_tip_diameter_mm * 0.42));
    effective_end_radius = std::min(end_radius, effective_start_radius * 1.05);
    add_branch_pad(mesh, start, std::max(effective_start_radius * 1.05, settings.tree_tip_diameter_mm * 0.5), std::max(0.2, settings.interface_layer_height_mm * 1.5), 14);
    if (branch_segment_clear_of_model(grid, start, end, effective_start_radius, effective_end_radius)) {
        add_layer_area_branch(mesh, start, end, effective_start_radius, effective_end_radius, curve_segments, ring_segments);
        result.emitted = true;
    }
    return result;
}

void record_tree_route(TreeMeshResult& result, const TreeRouteResult& route)
{
    if (route.emitted)
        ++result.branches;
    if (route.used_local_upright)
        ++result.local_uprights;
    if (route.used_waypoint)
        ++result.waypoint_branches;
    if (route.slope_reroute)
        ++result.slope_reroutes;
    if (route.model_reroute)
        ++result.model_reroutes;
}

TreeMeshResult mesh_organic_tree_grid(
    const ContactGrid& grid,
    const SupportSettings& settings,
    const std::vector<unsigned char>& contact_mask,
    const std::vector<double>& support_top,
    const std::vector<double>& interface_bottom,
    const std::vector<double>& interface_top,
    SupportMesh& support_out,
    SupportMesh& interface_out,
    CoverageSamples* tree_coverage,
    OrganicTreeLayerData* tree_layer_data)
{
    TreeMeshResult result;
    const double root_z = settings.base_enabled ? std::max(grid.bottom_z, settings.base_thickness_mm) : grid.bottom_z;

    const double tip_radius = std::max(0.2, settings.tree_tip_diameter_mm * 0.5);
    const double branch_radius = std::max(tip_radius, settings.tree_branch_diameter_mm * 0.5);
    const double branch_distance = std::max(settings.contact_cell_size_mm * 2.0, settings.tree_branch_distance_mm);
    const double sample_spacing = std::max(settings.contact_cell_size_mm * 1.6, std::min(branch_distance * 0.36, settings.contact_cell_size_mm * 3.4));
    const std::vector<TreeTip> tips = collect_tree_tips(grid, support_top, contact_mask, root_z, sample_spacing);
    if (tips.empty())
        return result;
    if (tree_coverage) {
        tree_coverage->cells.clear();
        tree_coverage->supported_cells = 0;
        tree_coverage->unsupported_cells = 0;
    }

    auto nearest_node_index = [](const Vec3& point, const std::vector<OrganicNode>& nodes) {
        int nearest = 0;
        double nearest_distance = std::numeric_limits<double>::max();
        for (int index = 0; index < int(nodes.size()); ++index) {
            const double distance = distance_xy(point, nodes[std::size_t(index)].point);
            if (distance < nearest_distance) {
                nearest_distance = distance;
                nearest = index;
            }
        }
        return nearest;
    };

    auto node_radius = [&](const OrganicNode& node) {
        const double raw_radius = organic_radius_for_distance(settings, node.distance_to_top, node.load);
        return std::max(tip_radius * 0.35, model_limited_radius(grid, node.point, raw_radius));
    };

    std::vector<OrganicNode> skeleton_nodes;
    std::vector<OrganicSkeletonEdge> skeleton_edges;
    skeleton_nodes.reserve(tips.size() * 2);
    skeleton_edges.reserve(tips.size() * 3);

    auto append_skeleton_node = [&](const OrganicNode& node) {
        skeleton_nodes.push_back(node);
        return int(skeleton_nodes.size()) - 1;
    };

    auto record_branch = [&](const int parent_id, const int child_id, const int level) {
        if (parent_id == child_id)
            return;
        skeleton_edges.push_back({ parent_id, child_id, level });
    };

    auto emit_branch = [&](const OrganicNode& parent, const OrganicNode& child, const int level) {
        Vec3 branch_start = parent.point;
        const double child_dx = child.point.x - parent.point.x;
        const double child_dy = child.point.y - parent.point.y;
        const double child_distance_xy = std::hypot(child_dx, child_dy);
        if (child_distance_xy > 1e-6) {
            const double emergence = std::min({ parent.radius * 0.22, grid.cell_size * 0.32, child_distance_xy * 0.38 });
            branch_start.x += child_dx / child_distance_xy * emergence;
            branch_start.y += child_dy / child_distance_xy * emergence;
        }
        branch_start.z += std::min(0.16, std::max(0.0, child.point.z - parent.point.z) * 0.08);
        const double vertical_drop = std::max(0.0, child.point.z - branch_start.z);
        if (vertical_drop <= 0.04)
            return;

        const double start_radius = std::max(tip_radius * 0.35, parent.radius);
        const double end_radius = std::max(tip_radius * 0.32, std::min(child.radius, start_radius * 0.92));
        const int curve_segments = std::max(2, std::min(8, 3 + level / 8));
        const int ring_segments = std::max(10, std::min(22, 10 + int(std::ceil(start_radius * 2.2))));
        record_tree_route(
            result,
            add_printable_organic_branch(
                support_out,
                grid,
                settings,
                branch_start,
                child.point,
                start_radius,
                end_radius,
                root_z,
                curve_segments,
                ring_segments));
    };

    std::vector<OrganicNode> current_nodes;
    std::vector<int> current_ids;
    current_nodes.reserve(tips.size());
    current_ids.reserve(tips.size());
    for (const TreeTip& tip : tips) {
        Vec3 tip_target = tip.point;
        tip_target.z -= std::max(0.05, settings.effective_top_z_distance_mm());
        const double contact_radius = std::max(tip_radius * 0.34, std::min(sample_spacing * 0.28, settings.xy_distance_mm + tip_radius * 0.5));
        ++result.tip_contacts;
        if (tree_coverage)
            record_coverage_sample(*tree_coverage, tip.point, true);
        OrganicNode tip_node { tip_target, 1.0, 0.0, contact_radius, 1 };
        current_ids.push_back(append_skeleton_node(tip_node));
        current_nodes.push_back(tip_node);
    }

    const double branch_angle = std::clamp(settings.tree_branch_angle_deg, 18.0, 70.0) * kPi / 180.0;
    const double max_lateral_per_mm = std::max(0.05, std::tan(branch_angle));
    const double layer_step = std::clamp(
        settings.interface_layer_height_mm > 0.02 ? settings.interface_layer_height_mm : 0.2,
        0.12,
        0.28);
    const double top_z = std::max_element(current_nodes.begin(), current_nodes.end(), [](const OrganicNode& lhs, const OrganicNode& rhs) {
        return lhs.point.z < rhs.point.z;
    })->point.z;
    const int max_layers = std::clamp(int(std::ceil((top_z - root_z) / std::max(layer_step, 0.2))) + 8, 12, 280);

    auto propose_dropped_node = [&](const OrganicNode& node, const std::vector<OrganicNode>& layer_nodes, const int layer) {
        const double dz = std::min(layer_step, std::max(0.0, node.point.z - root_z));
        OrganicNode candidate = node;
        candidate.point.z = std::max(root_z, node.point.z - dz);
        candidate.distance_to_top = node.distance_to_top + dz;
        candidate.radius = node_radius(candidate);

        const double merge_scan_radius = branch_distance * (0.72 + 0.018 * std::min(layer, 55));
        Vec3 attraction { 0.0, 0.0, 0.0 };
        double attraction_load = 0.0;
        int neighbor_count = 0;
        for (const OrganicNode& other : layer_nodes) {
            if (&other == &node)
                continue;
            const double distance = distance_xy(node.point, other.point);
            if (distance <= 0.001 || distance > merge_scan_radius)
                continue;
            const double weight = other.load / std::max(distance, grid.cell_size * 0.45);
            attraction = add(attraction, multiply(other.point, weight));
            attraction_load += weight;
            ++neighbor_count;
        }

        if (attraction_load > 0.0 && neighbor_count > 0) {
            const Vec3 target = multiply(attraction, 1.0 / attraction_load);
            const Vec3 delta { target.x - node.point.x, target.y - node.point.y, 0.0 };
            const double delta_len = std::hypot(delta.x, delta.y);
            const double max_move = std::max(0.0, dz * max_lateral_per_mm * 0.72);
            if (delta_len > 1e-6) {
                const double move = std::min(max_move, delta_len * 0.52);
                candidate.point.x += delta.x / delta_len * move;
                candidate.point.y += delta.y / delta_len * move;
            }
        }

        const double allowed_radius = model_limited_radius(grid, candidate.point, candidate.radius);
        candidate.radius = std::max(tip_radius * 0.32, allowed_radius);
        if (branch_point_clear_of_model(grid, candidate.point, candidate.radius) &&
            branch_segment_clear_of_model(grid, candidate.point, node.point, candidate.radius, node.radius))
            return candidate;

        OrganicNode vertical = candidate;
        vertical.point.x = node.point.x;
        vertical.point.y = node.point.y;
        vertical.radius = std::max(tip_radius * 0.32, model_limited_radius(grid, vertical.point, vertical.radius));
        if (branch_point_clear_of_model(grid, vertical.point, vertical.radius) &&
            branch_segment_clear_of_model(grid, vertical.point, node.point, vertical.radius, node.radius))
            return vertical;

        const double base_escape = std::max(grid.cell_size, candidate.radius + settings.xy_distance_mm);
        for (int ring = 1; ring <= 4; ++ring) {
            const double radius = base_escape * double(ring);
            for (int side = 0; side < 8; ++side) {
                const double angle = (2.0 * kPi * double(side) / 8.0) + double(layer % 3) * 0.19;
                OrganicNode escaped = candidate;
                escaped.point.x = node.point.x + std::cos(angle) * radius;
                escaped.point.y = node.point.y + std::sin(angle) * radius;
                const double horizontal = distance_xy(escaped.point, node.point);
                if (horizontal > dz * max_lateral_per_mm + 0.05)
                    continue;
                escaped.radius = std::max(tip_radius * 0.28, model_limited_radius(grid, escaped.point, escaped.radius));
                if (branch_point_clear_of_model(grid, escaped.point, escaped.radius) &&
                    branch_segment_clear_of_model(grid, escaped.point, node.point, escaped.radius, node.radius))
                    return escaped;
            }
        }

        candidate.point.x = node.point.x;
        candidate.point.y = node.point.y;
        candidate.radius = std::max(tip_radius * 0.26, model_limited_radius(grid, candidate.point, candidate.radius * 0.72));
        return candidate;
    };

    for (int layer = 0; layer < max_layers && !current_nodes.empty(); ++layer) {
        bool all_at_root = true;
        for (const OrganicNode& node : current_nodes) {
            if (node.point.z > root_z + 0.08) {
                all_at_root = false;
                break;
            }
        }
        if (all_at_root)
            break;

        std::vector<OrganicNode> proposed;
        proposed.reserve(current_nodes.size());
        for (const OrganicNode& node : current_nodes)
            proposed.push_back(propose_dropped_node(node, current_nodes, layer));

        const double merge_radius = std::min(
            branch_distance * 2.1,
            std::max(branch_distance * 0.38, grid.cell_size * (1.35 + 0.05 * std::min(layer, 28))));
        std::vector<unsigned char> used(proposed.size(), 0);
        std::vector<OrganicNode> next_nodes;
        std::vector<int> next_ids;
        next_nodes.reserve(proposed.size());
        next_ids.reserve(proposed.size());

        for (int seed = 0; seed < int(proposed.size()); ++seed) {
            if (used[std::size_t(seed)])
                continue;

            std::vector<int> group { seed };
            used[std::size_t(seed)] = 1;
            for (int index = seed + 1; index < int(proposed.size()); ++index) {
                if (used[std::size_t(index)])
                    continue;
                const double z_gap = std::abs(proposed[std::size_t(index)].point.z - proposed[std::size_t(seed)].point.z);
                if (z_gap > layer_step * 1.25)
                    continue;
                const double merge_acceptance = std::max(
                    grid.cell_size * 1.05,
                    (proposed[std::size_t(seed)].radius + proposed[std::size_t(index)].radius) * 0.82 + merge_radius * 0.16);
                if (distance_xy(proposed[std::size_t(index)].point, proposed[std::size_t(seed)].point) > merge_acceptance)
                    continue;
                group.push_back(index);
                used[std::size_t(index)] = 1;
                if (int(group.size()) >= 8)
                    break;
            }

            double load = 0.0;
            double z_sum = 0.0;
            Vec3 center { 0.0, 0.0, 0.0 };
            OrganicNode parent = proposed[std::size_t(seed)];
            parent.source_count = 0;
            parent.distance_to_top = 0.0;
            parent.radius = 0.0;
            for (const int index : group) {
                const OrganicNode& node = proposed[std::size_t(index)];
                load += node.load;
                center = add(center, multiply(node.point, node.load));
                z_sum += node.point.z * node.load;
                parent.source_count += current_nodes[std::size_t(index)].source_count;
                parent.distance_to_top = std::max(parent.distance_to_top, node.distance_to_top);
                parent.radius = std::max(parent.radius, node.radius);
            }
            center = multiply(center, 1.0 / std::max(load, 1e-6));
            parent.point = { center.x, center.y, z_sum / std::max(load, 1e-6) };
            parent.load = std::max(1.0, load);
            double printable_parent_z = parent.point.z;
            for (const int index : group) {
                const OrganicNode& child = current_nodes[std::size_t(index)];
                const double horizontal = distance_xy(parent.point, child.point);
                const double required_drop = horizontal / std::max(max_lateral_per_mm, 0.05) + 0.05;
                printable_parent_z = std::min(printable_parent_z, child.point.z - required_drop);
            }
            parent.point.z = std::max(root_z, printable_parent_z);
            parent.radius = node_radius(parent);

            if (!branch_point_clear_of_model(grid, parent.point, parent.radius))
                parent.radius = std::max(tip_radius * 0.28, model_limited_radius(grid, parent.point, parent.radius * 0.75));

            const int parent_id = append_skeleton_node(parent);
            next_nodes.push_back(parent);
            next_ids.push_back(parent_id);
            for (const int index : group)
                record_branch(parent_id, current_ids[std::size_t(index)], layer);
        }

        current_nodes = std::move(next_nodes);
        current_ids = std::move(next_ids);
    }

    std::vector<OrganicNode> root_nodes = cluster_nodes(current_nodes, branch_distance * 1.8);
    std::vector<int> root_ids;
    root_ids.reserve(root_nodes.size());
    for (OrganicNode& root : root_nodes) {
        root.point.z = root_z;
        root.radius = std::max(root.radius, organic_radius_for_distance(settings, root.distance_to_top + layer_step, root.load));
        root_ids.push_back(append_skeleton_node(root));
    }

    for (int child_index = 0; child_index < int(current_nodes.size()); ++child_index) {
        const OrganicNode& child = current_nodes[std::size_t(child_index)];
        if (root_nodes.empty())
            break;
        const int root_index = nearest_node_index(child.point, root_nodes);
        OrganicNode root = root_nodes[std::size_t(root_index)];
        root.point.z = root_z;
        root.load = std::max(root.load, child.load);
        root.radius = std::max(root.radius, organic_radius_for_distance(settings, child.distance_to_top + std::max(0.0, child.point.z - root_z), root.load));
        if (root_index >= 0 && root_index < int(root_ids.size())) {
            skeleton_nodes[std::size_t(root_ids[std::size_t(root_index)])] = root;
            record_branch(root_ids[std::size_t(root_index)], current_ids[std::size_t(child_index)], max_layers);
        }
    }

    std::vector<std::vector<int>> outgoing(skeleton_nodes.size());
    std::vector<int> incoming_count(skeleton_nodes.size(), 0);
    for (int edge_index = 0; edge_index < int(skeleton_edges.size()); ++edge_index) {
        const OrganicSkeletonEdge& edge = skeleton_edges[std::size_t(edge_index)];
        if (edge.parent_id < 0 || edge.child_id < 0 ||
            edge.parent_id >= int(skeleton_nodes.size()) || edge.child_id >= int(skeleton_nodes.size()))
            continue;
        outgoing[std::size_t(edge.parent_id)].push_back(edge_index);
        ++incoming_count[std::size_t(edge.child_id)];
    }

    collect_organic_layer_disks(
        tree_layer_data,
        skeleton_nodes,
        skeleton_edges,
        grid,
        root_z,
        top_z,
        layer_step);
    result.branches = skeleton_edges.size();

    for (const TreeTip& tip : tips) {
        const int cell_index = grid.index(tip.ix, tip.iy);
        if (cell_index >= int(interface_top.size()))
            continue;
        if (interface_top[std::size_t(cell_index)] <= interface_bottom[std::size_t(cell_index)] + 0.05)
            continue;
        add_tapered_tube(
            interface_out,
            { tip.point.x, tip.point.y, interface_bottom[std::size_t(cell_index)] },
            { tip.point.x, tip.point.y, interface_top[std::size_t(cell_index)] },
            tip_radius,
            tip_radius,
            14);
    }

    return result;
}

std::size_t mesh_contact_grid(
    const ContactGrid& grid,
    const SupportSettings& settings,
    const std::vector<unsigned char>& interface_eligible,
    SupportMesh& support_out,
    SupportMesh& interface_out,
    SupportGenerationStats* stats,
    CoverageSamples* coverage,
    OrganicTreeLayerData* tree_layer_data)
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

    if (settings.tree_mode) {
        const TreeMeshResult tree_result = mesh_organic_tree_grid(
            grid,
            settings,
            interface_eligible,
            support_top,
            interface_bottom,
            interface_top,
            support_out,
            interface_out,
            coverage,
            tree_layer_data);
        if (stats) {
            stats->tree_branches = tree_result.branches;
            stats->tree_tip_contacts = tree_result.tip_contacts;
            stats->tree_local_uprights = tree_result.local_uprights;
            stats->tree_waypoint_branches = tree_result.waypoint_branches;
            stats->tree_slope_reroutes = tree_result.slope_reroutes;
            stats->tree_model_reroutes = tree_result.model_reroutes;
        }
        return tree_result.branches;
    }

    mesh_height_field(grid, support_bottom, support_top, settings.base_enabled ? settings.base_thickness_mm : 0.0, support_out);
    if (interface_thickness > 0.05)
        mesh_height_field(grid, interface_bottom, interface_top, 0.0, interface_out);
    return 0;
}

SupportGenerationStats generate_orca_contact_proxy(
    const MeshStats& mesh_stats,
    const SupportSettings& settings,
    const std::vector<ManualSupportPoint>& manual_points,
    CoverageSamples& coverage,
    QaStats& qa,
    SupportMesh& support_out,
    SupportMesh& interface_out,
    OrganicTreeLayerData* tree_layer_data)
{
    SupportGenerationStats stats;
    if (!settings.enable_support || mesh_stats.vertices.size() < 3)
        return stats;

    using Clock = std::chrono::steady_clock;
    auto phase_start = Clock::now();
    const auto mark_ms = [&phase_start]() {
        const auto now = Clock::now();
        const double ms = std::chrono::duration<double, std::milli>(now - phase_start).count();
        phase_start = now;
        return ms;
    };

    const double support_cutoff_z = -std::sin(settings.threshold_angle_deg * kPi / 180.0);
    ContactGrid grid = make_contact_grid(mesh_stats, settings);
    stats.timing_grid_ms = mark_ms();
    populate_model_collision_ceiling(grid, mesh_stats, settings);
    stats.timing_model_ceiling_ms = mark_ms();

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
    stats.timing_overhang_ms = mark_ms();

    stats.envelope_cells = mark_lower_envelope_contacts(grid, mesh_stats, settings, coverage);
    stats.timing_lower_envelope_ms = mark_ms();
    stats.pruned_sparse_cells = prune_sparse_auto_contacts(grid);
    stats.pruned_small_island_cells = prune_small_contact_islands(grid, settings);
    stats.timing_prune_ms = mark_ms();

    for (const ManualSupportPoint& support : manual_points) {
        if (support.blocker)
            continue;
        if (mark_manual_support(grid, support, settings) > 0)
            ++stats.manual_points;
    }
    stats.timing_manual_ms = mark_ms();

    stats.closed_gap_cells = close_contact_gaps(grid);
    clamp_grid_to_model_ceiling(grid);
    stats.edge_clearance_removed_cells = apply_xy_edge_clearance(grid, settings.edge_clearance_mm);
    stats.foam_gap_removed_cells = apply_xy_edge_clearance(grid, settings.effective_foam_gap_xy_mm());
    std::size_t active_blocker_points = 0;
    const std::vector<unsigned char> blocker_mask = build_manual_blocker_mask(grid, manual_points, settings, &active_blocker_points);
    stats.manual_blocker_points = active_blocker_points;
    stats.manual_blocker_removed_cells += apply_manual_blocker_mask(grid, blocker_mask, grid.bottom_z);
    clamp_grid_to_model_ceiling(grid);
    stats.contact_cells = count_contact_cells(grid);
    stats.timing_gap_and_clearance_ms = mark_ms();
    qa = evaluate_support_qa(grid, settings);
    update_coverage_from_final_grid(coverage, grid, qa);
    stats.timing_qa_ms += mark_ms();
    if (stats.contact_cells == 0)
        return stats;

    const std::vector<unsigned char> interface_eligible = snapshot_occupied_cells(grid);

    if (settings.base_enabled) {
        const double blocker_foundation_top = !settings.support_blocker_cuts_base && (settings.base_enabled || settings.join_uprights_bottom_enabled)
            ? settings.base_thickness_mm
            : grid.bottom_z;
        stats.base_cells = grow_base_footprint(grid, settings.base_margin_mm, settings.base_thickness_mm);
        stats.manual_blocker_removed_cells += apply_manual_blocker_mask(grid, blocker_mask, blocker_foundation_top);
        if (settings.join_uprights_bottom_enabled)
            stats.bottom_join_cells = join_bottom_uprights(grid, settings.base_thickness_mm);
        stats.manual_blocker_removed_cells += apply_manual_blocker_mask(grid, blocker_mask, blocker_foundation_top);
    }
    stats.column_components_before = count_column_components(grid, settings);
    stats.column_merge_cells = merge_nearby_columns(grid, settings);
    stats.manual_blocker_removed_cells += apply_manual_blocker_mask(
        grid,
        blocker_mask,
        !settings.support_blocker_cuts_base && (settings.base_enabled || settings.join_uprights_bottom_enabled) ? settings.base_thickness_mm : grid.bottom_z
    );
    stats.column_components_after = count_column_components(grid, settings);
    stats.timing_base_ms = mark_ms();

    restore_lower_envelope_contact_heights(grid, interface_eligible);
    clamp_grid_to_model_ceiling(grid);
    qa = evaluate_support_qa(grid, settings);
    update_coverage_from_final_grid(coverage, grid, qa);
    stats.timing_qa_ms += mark_ms();
    if (settings.interface_top_layers > 0)
        stats.interface_cells = count_masked_cells(interface_eligible);
    stats.tree_branches = mesh_contact_grid(grid, settings, interface_eligible, support_out, interface_out, &stats, &coverage, tree_layer_data);
    stats.timing_mesh_ms = mark_ms();

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

void pack_support_mesh(const SupportMesh& mesh, PackedSupportMesh& packed)
{
    packed.vertices.clear();
    packed.vertices.reserve(mesh.vertices.size() * 3);
    for (const Vec3& vertex : mesh.vertices) {
        packed.vertices.push_back(static_cast<float>(vertex.x));
        packed.vertices.push_back(static_cast<float>(vertex.y));
        packed.vertices.push_back(static_cast<float>(vertex.z));
    }

    packed.triangles.clear();
    packed.triangles.reserve(mesh.triangles.size() * 3);
    for (const auto& triangle : mesh.triangles) {
        packed.triangles.push_back(static_cast<std::uint32_t>(std::max(0, triangle[0])));
        packed.triangles.push_back(static_cast<std::uint32_t>(std::max(0, triangle[1])));
        packed.triangles.push_back(static_cast<std::uint32_t>(std::max(0, triangle[2])));
    }
}

void append_support_mesh_metadata_json(std::ostringstream& out, const char* key, const PackedSupportMesh& mesh, const double cell_size_mm)
{
    out << "\"" << key << R"json(":{"coordinate_space":"world_mm","triangle_encoding":"indexed_triangles","binary_encoding":"wasm_typed_arrays","cell_size_mm":)json";
    append_number(out, cell_size_mm);
    out << R"json(,"vertex_count":)json"
        << (mesh.vertices.size() / 3)
        << R"json(,"triangle_count":)json"
        << (mesh.triangles.size() / 3)
        << R"json(,"vertices":null,"triangles":null})json";
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

void append_tree_layer_disks_json(std::ostringstream& out, const OrganicTreeLayerData& layer_data)
{
    const std::size_t disk_count = layer_data.disk_count();
    if (disk_count == 0) {
        out << R"json("tree_layer_disks":null)json";
        return;
    }

    out << R"json("tree_layer_disks":{"coordinate_space":"world_mm","shape":"layered_circle_unions","layer_height_mm":)json";
    append_number(out, layer_data.layer_height);
    out << R"json(,"bottom_z_mm":)json";
    append_number(out, layer_data.bottom_z);
    out << R"json(,"top_z_mm":)json";
    append_number(out, layer_data.top_z);
    out << R"json(,"circle_segments":)json"
        << layer_data.circle_segments
        << R"json(,"layer_count":)json"
        << layer_data.layers.size()
        << R"json(,"disk_count":)json"
        << disk_count
        << R"json(,"layers":[)json";

    bool wrote_layer = false;
    for (std::size_t layer_index = 0; layer_index < layer_data.layers.size(); ++layer_index) {
        const auto& disks = layer_data.layers[layer_index];
        if (disks.empty())
            continue;
        if (wrote_layer)
            out << ",";
        wrote_layer = true;
        const double layer_z = layer_data.bottom_z + double(layer_index) * layer_data.layer_height;
        out << R"json({"index":)json" << layer_index << R"json(,"z":)json";
        append_number(out, layer_z);
        out << R"json(,"disks":[)json";
        for (std::size_t disk_index = 0; disk_index < disks.size(); ++disk_index) {
            if (disk_index > 0)
                out << ",";
            out << "[";
            append_number(out, disks[disk_index].x);
            out << ",";
            append_number(out, disks[disk_index].y);
            out << ",";
            append_number(out, disks[disk_index].radius);
            out << "]";
        }
        out << "]}";
    }
    out << "]}";
}

} // namespace

std::string core_status()
{
    return "Cradlemaker WASM support core loaded";
}

std::string core_version()
{
    return "0.8.6";
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

std::string prepare_support_job_json_impl(const std::string& job_json, const bool binary_meshes, const bool buffered_input)
{
    using Clock = std::chrono::steady_clock;
    auto phase_start = Clock::now();
    const auto mark_ms = [&phase_start]() {
        const auto now = Clock::now();
        const double ms = std::chrono::duration<double, std::milli>(now - phase_start).count();
        phase_start = now;
        return ms;
    };

    MeshStats mesh_stats;
    const bool parsed_vertices = buffered_input
        ? ((mesh_stats = mesh_stats_from_vertex_values(g_input_vertices)).vertex_values > 0)
        : parse_numeric_array_after_key(job_json, "vertices", mesh_stats);
    const std::size_t declared_vertex_count = read_unsigned_field(job_json, "vertex_count");
    const std::size_t declared_triangle_count = read_unsigned_field(job_json, "triangle_count");
    const bool nonindexed_triplets = contains_json_string(job_json, "nonindexed_triplets");
    const bool mesh_ready = parsed_vertices && mesh_stats.vertex_values > 0 && mesh_stats.vertex_values % 9 == 0 && nonindexed_triplets;
    const double input_parse_ms = mark_ms();
    const SupportSettings settings = read_support_settings(job_json);
    const std::vector<ManualSupportPoint> manual_points = read_manual_support_points(job_json);
    const double settings_parse_ms = mark_ms();
    SupportMesh support_mesh;
    SupportMesh interface_mesh;
    CoverageSamples coverage;
    QaStats qa;
    OrganicTreeLayerData tree_layer_data;
    SupportGenerationStats support_stats = mesh_ready ? generate_orca_contact_proxy(mesh_stats, settings, manual_points, coverage, qa, support_mesh, interface_mesh, &tree_layer_data) : SupportGenerationStats {};
    support_stats.timing_input_parse_ms = input_parse_ms;
    support_stats.timing_settings_parse_ms = settings_parse_ms;
    support_stats.timing_generation_total_ms = mark_ms();
    const bool tree_layer_ready = settings.tree_mode && tree_layer_data.disk_count() > 0;
    const bool support_ready = mesh_ready && support_stats.contact_cells > 0 && (!support_mesh.triangles.empty() || !interface_mesh.triangles.empty() || tree_layer_ready);
    if (binary_meshes) {
        pack_support_mesh(support_mesh, g_last_binary_result.support);
        pack_support_mesh(interface_mesh, g_last_binary_result.interface_mesh);
        support_stats.timing_binary_pack_ms = mark_ms();
    } else {
        support_stats.timing_binary_pack_ms = 0.0;
        phase_start = Clock::now();
    }

    std::ostringstream out;
    out.precision(6);
    out << R"json({"status":")json"
        << (support_ready ? "support_mesh_generated" : (mesh_ready ? "no_support_regions" : "mesh_job_invalid"))
        << R"json(","native_target":"cradlemaker_support_core","algorithm":"cradle_lower_envelope_grid","message":")json"
        << (settings.tree_mode ?
            "WASM generated an original organic tree cradle graph from sliced underside contact samples. This is Cradlemaker-owned code, not ported Orca source." :
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
        << R"json(,"join_uprights_bottom_enabled":)json"
        << (settings.join_uprights_bottom_enabled ? "true" : "false")
        << R"json(,"merge_nearby_columns_enabled":)json"
        << (settings.merge_nearby_columns_enabled ? "true" : "false")
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
        << R"json(,"bottom_join_cells":)json"
        << support_stats.bottom_join_cells
        << R"json(,"column_merge_cells":)json"
        << support_stats.column_merge_cells
        << R"json(,"column_components_before":)json"
        << support_stats.column_components_before
        << R"json(,"column_components_after":)json"
        << support_stats.column_components_after
        << R"json(,"interface_cells":)json"
        << support_stats.interface_cells
        << R"json(,"edge_clearance_removed_cells":)json"
        << support_stats.edge_clearance_removed_cells
        << R"json(,"foam_gap_removed_cells":)json"
        << support_stats.foam_gap_removed_cells
        << R"json(,"manual_points":)json"
        << support_stats.manual_points
        << R"json(,"manual_blocker_points":)json"
        << support_stats.manual_blocker_points
        << R"json(,"manual_blocker_removed_cells":)json"
        << support_stats.manual_blocker_removed_cells
        << R"json(,"requested_orca_tree_mode":)json"
        << (settings.requested_orca_tree_mode ? "true" : "false")
        << R"json(,"real_orca_tree_available":)json"
        << (Cradlemaker::OrcaSupportBridge::real_orca_tree_support_available() ? "true" : "false")
        << R"json(,"original_organic_tree":)json"
        << (settings.tree_mode ? "true" : "false")
        << R"json(,"tree_mode":)json"
        << (settings.tree_mode ? "true" : "false")
        << R"json(,"tree_branches":)json"
        << support_stats.tree_branches
        << R"json(,"tree_tip_contacts":)json"
        << support_stats.tree_tip_contacts
        << R"json(,"tree_local_uprights":)json"
        << support_stats.tree_local_uprights
        << R"json(,"tree_waypoint_branches":)json"
        << support_stats.tree_waypoint_branches
        << R"json(,"tree_slope_reroutes":)json"
        << support_stats.tree_slope_reroutes
        << R"json(,"tree_model_reroutes":)json"
        << support_stats.tree_model_reroutes
        << R"json(,"timings_ms":{"grid":)json";
    append_number(out, support_stats.timing_grid_ms);
    out << R"json(,"model_ceiling":)json";
    append_number(out, support_stats.timing_model_ceiling_ms);
    out << R"json(,"overhang_scan":)json";
    append_number(out, support_stats.timing_overhang_ms);
    out << R"json(,"lower_envelope":)json";
    append_number(out, support_stats.timing_lower_envelope_ms);
    out << R"json(,"prune":)json";
    append_number(out, support_stats.timing_prune_ms);
    out << R"json(,"manual":)json";
    append_number(out, support_stats.timing_manual_ms);
    out << R"json(,"gap_clearance":)json";
    append_number(out, support_stats.timing_gap_and_clearance_ms);
    out << R"json(,"native_qa":)json";
    append_number(out, support_stats.timing_qa_ms);
    out << R"json(,"base_join":)json";
    append_number(out, support_stats.timing_base_ms);
    out << R"json(,"mesh":)json";
    append_number(out, support_stats.timing_mesh_ms);
    out << R"json(,"input_parse":)json";
    append_number(out, support_stats.timing_input_parse_ms);
    out << R"json(,"settings_parse":)json";
    append_number(out, support_stats.timing_settings_parse_ms);
    out << R"json(,"generation_total":)json";
    append_number(out, support_stats.timing_generation_total_ms);
    out << R"json(,"binary_pack":)json";
    append_number(out, support_stats.timing_binary_pack_ms);
    out << R"json(})json"
        << R"json(},)json";
    phase_start = Clock::now();
    if (binary_meshes)
        append_support_mesh_metadata_json(out, "support_mesh", g_last_binary_result.support, settings.contact_cell_size_mm);
    else
        append_support_mesh_json(out, "support_mesh", support_mesh, settings.contact_cell_size_mm);
    out << ",";
    if (binary_meshes)
        append_support_mesh_metadata_json(out, "interface_mesh", g_last_binary_result.interface_mesh, settings.contact_cell_size_mm);
    else
        append_support_mesh_json(out, "interface_mesh", interface_mesh, settings.contact_cell_size_mm);
    const double mesh_json_ms = mark_ms();
    out << ",";
    append_tree_layer_disks_json(out, tree_layer_data);
    const double tree_json_ms = mark_ms();
    out << ",";
    append_coverage_json(out, coverage);
    const double coverage_json_ms = mark_ms();
    out << ",";
    append_qa_json(out, qa);
    const double qa_json_ms = mark_ms();
    out << R"json(,"top_level_timings_ms":{"mesh_json":)json";
    append_number(out, mesh_json_ms);
    out << R"json(,"tree_json":)json";
    append_number(out, tree_json_ms);
    out << R"json(,"coverage_json":)json";
    append_number(out, coverage_json_ms);
    out << R"json(,"qa_json":)json";
    append_number(out, qa_json_ms);
    out << R"json(})json";
    out << "}";
    return out.str();
}

std::string prepare_support_job_json(const std::string& job_json)
{
    return prepare_support_job_json_impl(job_json, false, false);
}

std::string prepare_support_job_binary_json(const std::string& job_json)
{
    return prepare_support_job_json_impl(job_json, true, false);
}

std::string prepare_support_job_buffered_input_binary_json(const std::string& job_json)
{
    return prepare_support_job_json_impl(job_json, true, true);
}

void allocate_input_vertices(const std::size_t value_count)
{
    g_input_vertices.assign(value_count, 0.0f);
}

std::uintptr_t input_vertices_ptr()
{
    return reinterpret_cast<std::uintptr_t>(g_input_vertices.data());
}

std::size_t input_vertices_length()
{
    return g_input_vertices.size();
}

std::uintptr_t last_support_vertices_ptr()
{
    return reinterpret_cast<std::uintptr_t>(g_last_binary_result.support.vertices.data());
}

std::size_t last_support_vertices_length()
{
    return g_last_binary_result.support.vertices.size();
}

std::uintptr_t last_support_triangles_ptr()
{
    return reinterpret_cast<std::uintptr_t>(g_last_binary_result.support.triangles.data());
}

std::size_t last_support_triangles_length()
{
    return g_last_binary_result.support.triangles.size();
}

std::uintptr_t last_interface_vertices_ptr()
{
    return reinterpret_cast<std::uintptr_t>(g_last_binary_result.interface_mesh.vertices.data());
}

std::size_t last_interface_vertices_length()
{
    return g_last_binary_result.interface_mesh.vertices.size();
}

std::uintptr_t last_interface_triangles_ptr()
{
    return reinterpret_cast<std::uintptr_t>(g_last_binary_result.interface_mesh.triangles.data());
}

std::size_t last_interface_triangles_length()
{
    return g_last_binary_result.interface_mesh.triangles.size();
}

} // namespace Cradlemaker::SupportCore
