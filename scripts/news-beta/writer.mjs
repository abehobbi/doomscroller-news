import { cardSchema, auditSchema } from '../../artifacts/summary-feasibility/round-9/schema.mjs'
import { parseStrict } from '../../artifacts/summary-feasibility/round-9/strict-json.mjs'
import { ordinary } from '../../artifacts/summary-feasibility/round-9/prompts.mjs'

export const MODEL = '@cf/google/gemma-4-26b-a4b-it'
export const DATE_RETRY_REMINDER = 'Use only the permitted exact event dates supplied in the evidence. Do not infer or calculate another calendar date.'
export const WRITER_CONFIGURATION = Object.freeze({
  model: MODEL, temperature: 0.2, maxCompletionTokens: 1024,
  responseFormat: 'json_schema', thinking: false, retries: 'date-only; maximum one', repair: false,
})

function credentials() {
  if (process.env.FREE_PLAN_CONFIRMED !== 'yes') throw new Error('FREE_PLAN_CONFIRMED=yes is required; no paid fallback exists')
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) throw new Error('Cloudflare credentials are missing')
  return { accountId: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN }
}

const safeHeaders = response => Object.fromEntries([...response.headers].filter(([name]) =>
  /^(?:cf-ray|retry-after|(?:x-)?request-id|x-correlation-id|(?:x-)?ratelimit[\w-]*|x-rate-limit[\w-]*)$/i.test(name)))

export async function writeCard(packet, { dateRetry = false } = {}) {
  const { accountId, token } = credentials()
  const systemPrompt = dateRetry ? `${ordinary} ${DATE_RETRY_REMINDER}` : ordinary
  const request = {
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: JSON.stringify({ source_led_packet: packet }) }],
    temperature: 0.2,
    max_completion_tokens: 1024,
    response_format: { type: 'json_schema', json_schema: cardSchema },
    chat_template_kwargs: { enable_thinking: false },
    store: false,
  }
  const timestamp = new Date().toISOString(), started = performance.now()
  let response, raw
  try {
    response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(request), signal: AbortSignal.timeout(55_000),
    })
    raw = await response.text()
  } catch (error) {
    return { timestamp, requestedModel: MODEL, state: 'provider_network_failure', error: error.name, latencyMs: Math.round(performance.now() - started), complete: false, parsed: null, rawStructuredText: null }
  }
  let body = null, providerParseError = null
  try { body = parseStrict(raw) } catch (error) { providerParseError = error.message }
  const result = body?.result, choice = result?.choices?.[0]
  const exposed = result?.response ?? choice?.message?.content ?? null
  let parsed = exposed !== null && typeof exposed === 'object' ? exposed : null, parseError = null
  const rawStructuredText = typeof exposed === 'string' ? exposed : null
  if (rawStructuredText !== null) try { parsed = parseStrict(rawStructuredText) } catch (error) { parseError = error.message }
  const schemaAudit = auditSchema(parsed), finishReason = choice?.finish_reason ?? null
  const complete = response.ok && body?.success !== false && !providerParseError && !parseError && schemaAudit.valid && (finishReason === null || finishReason === 'stop')
  return {
    timestamp, finishedAt: new Date().toISOString(), requestedModel: MODEL, returnedModel: result?.model ?? null,
    httpStatus: response.status, internalErrors: body?.errors ?? [], rawStructuredText, parsed,
    parseError, providerParseError, schemaAudit, finishReason, usage: result?.usage ?? body?.usage ?? null,
    latencyMs: Math.round(performance.now() - started), safeHeaders: safeHeaders(response), complete,
    structuralStatus: complete ? 'valid_card' : !response.ok || body?.success === false ? 'provider_failure' : providerParseError || parseError ? 'malformed_json' : finishReason && finishReason !== 'stop' ? 'truncated' : 'schema_failure',
    dateRetry,
  }
}
