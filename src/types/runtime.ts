import type { DetailedResponse, FactLensResponseMeta, FactLensServerTiming, ResponseMeta, ServerTimingPhases } from "../runtime/response-meta.js";
import type { VerifyResponse } from "./index.js";

export type {
  DetailedResponse,
  FactLensResponseMeta,
  FactLensServerTiming,
  ResponseMeta,
  ServerTimingPhases,
};

export type DetailedVerifyResponse = DetailedResponse<VerifyResponse>;
