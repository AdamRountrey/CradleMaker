#include "OrcaSupportBridge.hpp"

#include <sstream>

namespace Cradlemaker::OrcaSupportBridge {

bool real_orca_tree_support_available()
{
    return false;
}

std::string real_orca_support_plan_json()
{
    std::ostringstream out;
    out << R"json({
"native_target":"cradlemaker_support_core",
"strategy":"port_orca_printobject_support_pipeline",
"real_orca_tree_support_available":false,
"orca_tree_source_probe_compiles":true,
"orca_tree_probe_target":"cradlemaker_orca_support_probe",
"required_entry_points":[
"Slic3r::PrintObject::generate_support_material",
"Slic3r::PrintObject::_generate_support_material",
"Slic3r::TreeSupport::generate",
"Slic3r::generate_tree_support_3D",
"Slic3r::TreeSupport3D::generate_support_areas"
],
"required_support_sources":[
"src/libslic3r/PrintObject.cpp",
"src/libslic3r/PrintObjectSlice.cpp",
"src/libslic3r/Support/SupportCommon.cpp",
"src/libslic3r/Support/SupportMaterial.cpp",
"src/libslic3r/Support/TreeModelVolumes.cpp",
"src/libslic3r/Support/TreeSupport.cpp",
"src/libslic3r/Support/TreeSupport3D.cpp"
],
"organic_tree_stages":[
"detect overhang polygons from sliced object layers",
"precalculate collision, avoidance, wall restriction, bed, and placeable areas",
"create initial support influence areas",
"propagate influence areas downward layer by layer",
"place support nodes inside valid areas",
"smooth branches while avoiding model collisions",
"extrude branch meshes and slice them back into support polygons",
"emit support, contact, and interface layers"
],
"solidification":"Cradlemaker-owned watertight cradle solidification from Orca support polygons",
"next_build_step":"construct a headless Print/PrintObject from uploaded mesh, run Orca organic tree support generation, then solidify returned SupportLayer polygons",
"known_port_boundary":[
"Print/PrintObject construction from browser mesh",
"PrintConfig and PrintObjectConfig initialization with Orca support keys",
"object slicing/layer generation before TreeSupport::generate",
"conversion from generated SupportLayer polygons to independent cradle mesh export"
]
})json";
    return out.str();
}

} // namespace Cradlemaker::OrcaSupportBridge
