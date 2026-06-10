#pragma once

#include <string>

namespace Cradlemaker::SupportCore {

std::string core_status();
std::string core_version();
std::string support_option_schema_json();
std::string support_core_plan_json();
std::string prepare_support_job_json(const std::string& job_json);

} // namespace Cradlemaker::SupportCore
