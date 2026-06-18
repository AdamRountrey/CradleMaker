#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace Cradlemaker::SupportCore {

std::string core_status();
std::string core_version();
std::string support_option_schema_json();
std::string support_core_plan_json();
std::string prepare_support_job_json(const std::string& job_json);
std::string prepare_support_job_binary_json(const std::string& job_json);
std::string prepare_support_job_buffered_input_binary_json(const std::string& job_json);
void allocate_input_vertices(std::size_t value_count);
std::uintptr_t input_vertices_ptr();
std::size_t input_vertices_length();
std::uintptr_t last_support_vertices_ptr();
std::size_t last_support_vertices_length();
std::uintptr_t last_support_triangles_ptr();
std::size_t last_support_triangles_length();
std::uintptr_t last_interface_vertices_ptr();
std::size_t last_interface_vertices_length();
std::uintptr_t last_interface_triangles_ptr();
std::size_t last_interface_triangles_length();

} // namespace Cradlemaker::SupportCore
