// Test doubles for other packages' tests (`@edmate/gateway/testing`). Nothing here reaches a
// network or reveals a key.
export {
  createScriptedTranscriber,
  ScriptedTranscriberError,
  type ScriptedTranscriber,
  type ScriptedTranscription,
} from './scriptedTranscriber.js';
