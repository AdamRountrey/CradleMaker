#include <emscripten/bind.h>

#include "SupportCore.hpp"

EMSCRIPTEN_BINDINGS(cradlemaker_core)
{
    using namespace Cradlemaker::SupportCore;

    emscripten::function("coreStatus", &Cradlemaker::SupportCore::core_status);
    emscripten::function("coreVersion", &Cradlemaker::SupportCore::core_version);
    emscripten::function("supportOptionSchemaJson", &Cradlemaker::SupportCore::support_option_schema_json);
    emscripten::function("supportCorePlanJson", &Cradlemaker::SupportCore::support_core_plan_json);
    emscripten::function("prepareSupportJobJson", &Cradlemaker::SupportCore::prepare_support_job_json);
    emscripten::function("prepareSupportJobBinaryJson", &Cradlemaker::SupportCore::prepare_support_job_binary_json);
    emscripten::function("prepareSupportJobBufferedInputBinaryJson", &Cradlemaker::SupportCore::prepare_support_job_buffered_input_binary_json);
    emscripten::function("allocateInputVertices", &Cradlemaker::SupportCore::allocate_input_vertices);
    emscripten::function("inputVerticesPtr", &Cradlemaker::SupportCore::input_vertices_ptr);
    emscripten::function("inputVerticesLength", &Cradlemaker::SupportCore::input_vertices_length);
    emscripten::function("lastSupportVerticesPtr", &Cradlemaker::SupportCore::last_support_vertices_ptr);
    emscripten::function("lastSupportVerticesLength", &Cradlemaker::SupportCore::last_support_vertices_length);
    emscripten::function("lastSupportTrianglesPtr", &Cradlemaker::SupportCore::last_support_triangles_ptr);
    emscripten::function("lastSupportTrianglesLength", &Cradlemaker::SupportCore::last_support_triangles_length);
    emscripten::function("lastInterfaceVerticesPtr", &Cradlemaker::SupportCore::last_interface_vertices_ptr);
    emscripten::function("lastInterfaceVerticesLength", &Cradlemaker::SupportCore::last_interface_vertices_length);
    emscripten::function("lastInterfaceTrianglesPtr", &Cradlemaker::SupportCore::last_interface_triangles_ptr);
    emscripten::function("lastInterfaceTrianglesLength", &Cradlemaker::SupportCore::last_interface_triangles_length);
    emscripten::function("inputVerticesView", emscripten::optional_override([]() {
        return emscripten::val(emscripten::typed_memory_view(
            input_vertices_length(),
            reinterpret_cast<float*>(input_vertices_ptr())
        ));
    }));
    emscripten::function("lastSupportVerticesView", emscripten::optional_override([]() {
        return emscripten::val(emscripten::typed_memory_view(
            last_support_vertices_length(),
            reinterpret_cast<const float*>(last_support_vertices_ptr())
        ));
    }));
    emscripten::function("lastSupportTrianglesView", emscripten::optional_override([]() {
        return emscripten::val(emscripten::typed_memory_view(
            last_support_triangles_length(),
            reinterpret_cast<const std::uint32_t*>(last_support_triangles_ptr())
        ));
    }));
    emscripten::function("lastInterfaceVerticesView", emscripten::optional_override([]() {
        return emscripten::val(emscripten::typed_memory_view(
            last_interface_vertices_length(),
            reinterpret_cast<const float*>(last_interface_vertices_ptr())
        ));
    }));
    emscripten::function("lastInterfaceTrianglesView", emscripten::optional_override([]() {
        return emscripten::val(emscripten::typed_memory_view(
            last_interface_triangles_length(),
            reinterpret_cast<const std::uint32_t*>(last_interface_triangles_ptr())
        ));
    }));
}
