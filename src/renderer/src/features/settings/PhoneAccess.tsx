import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Smartphone } from 'lucide-react'
import type { RemoteInfo } from '@shared/types'
import { Badge, Button, Card, Toggle } from '@/components/ui'
import { InfoTip } from '@/components/InfoTip'
import { errorMessage, toast } from '@/components/Toast'
import { useApp } from '@/stores/app'
import { studio } from '@/lib/api'

/** Settings → Use on your phone: switch phone access on, then pair a phone by scanning the QR code. */
export function PhoneAccess() {
  const settings = useApp((s) => s.settings)!
  const update = useApp((s) => s.updateSettings)
  const [info, setInfo] = useState<RemoteInfo | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    studio.getRemoteInfo().then(setInfo)
    return studio.on('remoteServer', setInfo)
  }, [])

  const on = !!settings.remoteEnabled
  const toggle = async (v: boolean) => {
    setBusy(true)
    try {
      await update({ remoteEnabled: v })
    } finally {
      setBusy(false)
    }
  }
  const unpair = async () => {
    try {
      setInfo(await studio.resetRemotePairing())
      toast.success('Phones unpaired', 'Scan the new code to pair a phone again.')
    } catch (e) {
      toast.error('Couldn’t reset pairing', errorMessage(e))
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted">
          <Smartphone className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold">
            Use on your phone
            {on && (info?.running ? <Badge tone="green">On</Badge> : info?.error ? <Badge tone="red">Problem</Badge> : null)}
          </div>
          <div className="mt-0.5 text-[13px] text-ink-3">
            Open Voiceify in your phone’s browser and use everything from there, while this Mac does the work. Your phone needs to be on the same Wi-Fi.
          </div>
        </div>
        <Toggle checked={on} onChange={toggle} disabled={busy} />
      </div>

      <AnimatePresence initial={false}>
        {on && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            {info?.error ? (
              <p className="mt-4 rounded-xl bg-red-500/10 px-3 py-2.5 text-[13px] text-danger">{info.error}</p>
            ) : info?.running ? (
              <div className="mt-5 space-y-4">
                <div className="flex items-center gap-5">
                  <img src={info.qr} alt="Pairing code" className="size-36 shrink-0 rounded-xl border border-line bg-white p-1.5" />
                  <ol className="space-y-2 text-[13px] text-ink-2">
                    <li>
                      <b className="font-medium text-ink">1.</b> Point your phone’s camera at the code and tap the link.
                    </li>
                    <li>
                      <b className="font-medium text-ink">2.</b> That’s it: your phone is paired and opens Voiceify.
                    </li>
                    <li className="text-ink-3">
                      Tip: add it to your Home Screen (Share → Add to Home Screen) to open it like an app.
                    </li>
                    <li className="text-xs text-ink-3">
                      Or type <span className="select-text font-mono text-ink-2">{info.urls[0]}</span> and scan again when asked.
                    </li>
                  </ol>
                </div>

                <div className="flex items-center gap-3 border-t border-line pt-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">Keep this Mac awake</div>
                    <div className="text-xs text-ink-3">So your phone can always reach it. The screen can still turn off; closing the lid sleeps it unless it’s plugged in.</div>
                  </div>
                  <Toggle checked={settings.remoteKeepAwake !== false} onChange={(v) => update({ remoteKeepAwake: v })} />
                </div>

                <div className="flex items-center gap-3 border-t border-line pt-4">
                  <div className="min-w-0 flex-1 text-xs text-ink-3">
                    Only phones that scanned this code can connect.{' '}
                    <span className="inline-flex items-center gap-1 align-middle">
                      Recording with the phone’s microphone isn’t available over Wi-Fi.
                      <InfoTip width={300}>
                        Browsers only allow the microphone on secure (HTTPS) connections, which a home network doesn’t have. Record in Voice Memos and
                        upload the file instead. If macOS asks whether Voiceify may accept incoming connections, choose Allow.
                      </InfoTip>
                    </span>
                  </div>
                  <Button size="sm" variant="outline" onClick={unpair}>
                    Unpair all phones
                  </Button>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-[13px] text-ink-3">Starting…</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}
