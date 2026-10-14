import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { EnhanceMode, EnhanceSettings } from '@shared/types'
import { ENHANCE_PROVIDERS, paramsFor } from '@shared/providers'
import { useApp } from './app'

interface EnhanceState {
  mode: EnhanceMode
  solver: 'midpoint' | 'euler'
  /** Page overrides; unset = your default from Settings → Model settings (then the model's). */
  nfe?: number
  lambd?: number
  tau?: number
}

/** Speech Enhancement page choices (kept between sessions). */
export const useEnhance = create<EnhanceState>()(persist((): EnhanceState => ({ mode: 'enhance', solver: 'midpoint' }), { name: 'enhance-state' }))

/** Settings in effect: page override → your default → model default. */
export function enhanceValues(s: EnhanceState, provider = ENHANCE_PROVIDERS[0]?.id ?? 'resemble-enhance'): EnhanceSettings {
  const own = useApp.getState().settings?.providerDefaults?.[provider] ?? {}
  const page: Record<string, number> = {}
  if (s.nfe !== undefined) page.steps = s.nfe
  if (s.lambd !== undefined) page.denoiseStrength = s.lambd
  if (s.tau !== undefined) page.priorTemperature = s.tau
  const v = paramsFor(provider, page, own)
  return { nfe: v.steps, lambd: v.denoiseStrength, tau: v.priorTemperature, solver: s.solver }
}
