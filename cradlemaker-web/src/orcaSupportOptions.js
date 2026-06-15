export const ORCA_SUPPORT_OPTIONS = [
  { key: "enable_support", type: "bool", defaultValue: true },
  { key: "support_interface_enabled", type: "bool", defaultValue: false },
  { key: "foam_gap_enabled", type: "bool", defaultValue: false },
  {
    key: "support_type",
    type: "enum",
    defaultValue: "normal(auto)",
    values: ["normal(auto)", "tree(auto)", "normal(manual)", "tree(manual)"],
  },
  {
    key: "support_style",
    type: "enum",
    defaultValue: "default",
    values: ["default", "grid", "snug", "organic", "tree_slim", "tree_strong", "tree_hybrid"],
  },
  {
    key: "support_base_pattern",
    type: "enum",
    defaultValue: "default",
    values: ["default", "rectilinear", "rectilinear-grid", "honeycomb", "lightning", "hollow"],
  },
  {
    key: "support_interface_pattern",
    type: "enum",
    defaultValue: "auto",
    values: ["auto", "rectilinear", "concentric", "rectilinear_interlaced", "grid"],
  },
  { key: "support_threshold_angle", type: "int", defaultValue: 30 },
  { key: "support_threshold_overlap", type: "percent", defaultValue: "50%" },
  { key: "support_on_build_plate_only", type: "bool", defaultValue: false },
  { key: "support_critical_regions_only", type: "bool", defaultValue: false },
  { key: "support_remove_small_overhang", type: "bool", defaultValue: true },
  { key: "support_top_z_distance", type: "float", defaultValue: 0.2 },
  { key: "support_bottom_z_distance", type: "float", defaultValue: 0.2 },
  { key: "support_object_xy_distance", type: "float", defaultValue: 0.35 },
  { key: "support_edge_clearance_mm", type: "float", defaultValue: 0 },
  { key: "support_base_pattern_spacing", type: "float", defaultValue: 0.8 },
  { key: "support_interface_top_layers", type: "int", defaultValue: 0 },
  { key: "support_interface_bottom_layers", type: "int", defaultValue: 0 },
  { key: "support_interface_spacing", type: "float", defaultValue: 0.5 },
  { key: "support_bottom_interface_spacing", type: "float", defaultValue: 0.5 },
  { key: "foam_gap_z_mm", type: "float", defaultValue: 0 },
  { key: "foam_gap_xy_mm", type: "float", defaultValue: 0 },
  { key: "tree_support_branch_distance", type: "float", defaultValue: 10 },
  { key: "tree_support_tip_diameter", type: "float", defaultValue: 2 },
  { key: "tree_support_branch_diameter", type: "float", defaultValue: 6 },
  { key: "tree_support_branch_angle", type: "float", defaultValue: 45 },
  { key: "tree_support_wall_count", type: "int", defaultValue: 1 },
];

export function defaultOrcaSupportConfig() {
  return Object.fromEntries(ORCA_SUPPORT_OPTIONS.map((option) => [option.key, option.defaultValue]));
}
