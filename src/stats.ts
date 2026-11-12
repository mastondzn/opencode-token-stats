import type {
  ModelInfo,
  SessionMessageAssistant,
  SessionMessageInfo,
  TokenUsageInfo,
} from "@opencode/client"

export interface TokenTotals {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  total: number
}

export interface ContextUsage {
  used: number
  limit?: number
  percent?: number
}

export interface StatsSnapshot {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cost: number
  contextUsed?: number
  contextLimit?: number
  tps?: number
  tpsAvg?: number
  ttftMs?: number
  ttftAvgMs?: number
  durationMs?: number
}

export function sumTokens(tokens: TokenUsageInfo | undefined): TokenTotals {
  if (!tokens) {
    return {
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    }
  }

  const input = tokens.input
  const output = tokens.output
  const reasoning = tokens.reasoning
  const cacheRead = tokens.cache.read
  const cacheWrite = tokens.cache.write

  return {
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    total: input + output + reasoning + cacheRead + cacheWrite,
  }
}

export function findModel(
  models: readonly ModelInfo[] | undefined,
  ref: { providerID: string; id: string } | undefined,
): ModelInfo | undefined {
  if (!models || !ref) return undefined
  return models.find(
    (model) =>
      model.providerID === ref.providerID &&
      (model.id === ref.id || model.modelID === ref.id),
  )
}

function isAssistantWithUsage(
  message: SessionMessageInfo | undefined,
): message is SessionMessageAssistant & { tokens: TokenUsageInfo } {
  return message?.type === "assistant" && message.tokens !== undefined
}

export function lastAssistantWithUsage(
  messages: readonly SessionMessageInfo[],
  boundary?: string,
): (SessionMessageAssistant & { tokens: TokenUsageInfo }) | undefined {
  let end = messages.length

  if (boundary !== undefined) {
    const boundaryIndex = messages.findIndex((message) => message.id === boundary)
    if (boundaryIndex === -1) return undefined
    end = boundaryIndex
  }

  let compactionIndex = -1
  for (let index = end - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.type === "compaction" && message.status === "completed") {
      compactionIndex = index
      break
    }
  }

  for (let index = end - 1; index > compactionIndex; index--) {
    const message = messages[index]
    if (isAssistantWithUsage(message)) return message
  }

  return undefined
}

export function contextUsage(
  messages: readonly SessionMessageInfo[],
  models: readonly ModelInfo[] | undefined,
  boundary?: string,
): ContextUsage | undefined {
  const message = lastAssistantWithUsage(messages, boundary)
  if (!message) return undefined

  const { input, output, reasoning, cache } = message.tokens
  const used = input + output + reasoning + cache.read + cache.write
  if (!Number.isFinite(used) || used <= 0) return undefined

  const model = findModel(models, message.model)
  const limit = model?.limit.context
  const percent =
    limit !== undefined && Number.isFinite(limit) && limit > 0
      ? (used / limit) * 100
      : undefined

  return { used, limit, percent }
}
