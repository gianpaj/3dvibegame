// The Gemini voxel caller now lives in @3dvibegame/ai-planning so it can be
// shared with the server-side /author endpoint.
export {
  coreFromSourceSpec,
  defaultGeminiModel,
  defaultGeminiTimeoutMs,
  generateVoxelCore,
  generateVoxelEdit,
  type GeminiUsageMetadata,
  type GeminiVoxelResult,
  type GenerateVoxelCoreOptions,
  type GenerateVoxelEditOptions,
  type VoxelPurpose,
} from "@3dvibegame/ai-planning";
