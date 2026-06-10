#include <emscripten/bind.h>

#include "SupportCore.hpp"

EMSCRIPTEN_BINDINGS(cradlemaker_core)
{
    emscripten::function("coreStatus", &Cradlemaker::SupportCore::core_status);
    emscripten::function("coreVersion", &Cradlemaker::SupportCore::core_version);
    emscripten::function("supportOptionSchemaJson", &Cradlemaker::SupportCore::support_option_schema_json);
    emscripten::function("supportCorePlanJson", &Cradlemaker::SupportCore::support_core_plan_json);
    emscripten::function("prepareSupportJobJson", &Cradlemaker::SupportCore::prepare_support_job_json);
}
