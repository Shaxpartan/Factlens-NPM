import type { ResponseMeta, ServerTimingPhases } from "../runtime/response-meta.js";
import type { VerifyResponse } from "./index.js";

export type { ResponseMeta, ServerTimingPhases };
export type DetailedVerifyResponse = {
  data: VerifyResponse;
  meta: ResponseMeta;
};