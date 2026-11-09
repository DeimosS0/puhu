// Send to phone, and from it (island/phone.ts): Puhu stands beside a sign that holds the
// QR code. A phone opens it and the sign turns to what is going; sent, a paper plane takes
// off from it; from the phone, each file lands in a list under the line. Before anything,
// on a Public network, the card asks whether it is the user's.

import { h, svg, clear } from "./dom";
import { State, type PhoneSession } from "../core/state";
import { language, t, tl, tn } from "../i18n/i18n";
import { bytes } from "./usb";
import type { ViewActions, ViewHost } from "./views";

/** A phone: its body, its screen, the dot of its button. */
export const PHONE_ICON = "M7.5 2.5h9A1.5 1.5 0 0 1 18 4v16a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V4a1.5 1.5 0 0 1 1.5-1.5zM10.5 18.5h3";
const PLANE = "M2.5 11.2 21 3.5l-5.6 17-4.3-6.6zM11.1 13.9 21 3.5";
/** The QR code's side on the card, CSS px, and its white margin in modules. */
const QR_PX = 128;
const QR_QUIET = 2;
/** With nobody connected this long, the card suggests the phone's hotspot. */
const HOTSPOT_HINT_MS = 30_000;
/** Told once, after the first phone ever connected: Windows had let Puhu use the network. */
const FIREWALL_TOLD_KEY = "puhu.phoneFirewallTold";

function firewallTold(): boolean {
  try {
    return localStorage.getItem(FIREWALL_TOLD_KEY) === "1";
  } catch {
    return false;
  }
}

function drawQr(canvas: HTMLCanvasElement, size: number, bits: string) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(QR_PX * dpr);
  canvas.height = Math.round(QR_PX * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx || size <= 0) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Whole device pixels a module, centred: crisp edges are what a camera reads best.
  const unit = Math.floor(canvas.width / (size + 2 * QR_QUIET));
  const offset = Math.round((canvas.width - unit * size) / 2);
  ctx.fillStyle = "#0b0c0e";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (bits[y * size + x] === "1") ctx.fillRect(offset + x * unit, offset + y * unit, unit, unit);
    }
  }
}

export function buildPhone(actions: ViewActions): ViewHost {
  const qr = h("canvas", { class: "phone-qr" }) as HTMLCanvasElement;
  const panel = h("div", { class: "phone-panel" }, qr);
  const sign = h("div", { class: "phone-sign" }, panel, h("div", { class: "phone-post" }));
  const text = h("div", { class: "phone-text" });
  const stack = h("div", { class: "stack phone-stack" }, sign, text);
  const card = h("div", { class: "card phone-card" }, stack);
  const el = h("div", { class: "view" }, card);

  let drawnQr = "";
  let shown = "";
  let hintTimer = 0;
  let hotspotHint = false;
  let flown: PhoneSession | null = null;

  /** The paper plane: off the sign and away, once everything reached the phone. */
  function fly() {
    const plane = h("div", { class: "phone-plane" }, svg(PLANE, 18, { stroke: 1.6 }));
    card.append(plane);
    const flight = plane.animate([
      { transform: "translate(0, 0) rotate(-20deg) scale(0.5)", opacity: 0 },
      { transform: "translate(20px, -14px) rotate(-8deg) scale(1)", opacity: 1, offset: 0.2 },
      { transform: "translate(150px, -30px) rotate(-14deg) scale(1)", opacity: 1, offset: 0.65 },
      { transform: "translate(320px, -120px) rotate(-24deg) scale(0.7)", opacity: 0 },
    ], { duration: 1100, easing: "cubic-bezier(0.45, 0, 0.3, 1)" });
    flight.onfinish = () => plane.remove();
  }

  function line(cls: string, words: string): HTMLElement {
    return h("div", { class: cls, text: words });
  }

  function draw(s: PhoneSession) {
    const key = JSON.stringify([s.stage, s.mode, s.device, s.received.length, s.note, hotspotHint, s.qrBits.length]);
    // The bar moves on its own; everything else is drawn again only when it changed.
    const bar = text.querySelector<HTMLElement>(".phone-bar i");
    const progress = s.mode === "send"
      ? (() => {
        const total = s.files.reduce((n, f) => n + f.size, 0);
        return total > 0 ? s.files.reduce((n, f) => n + f.done, 0) / total : 0;
      })()
      : s.incoming && s.incoming.total > 0 ? s.incoming.done / s.incoming.total : 0;
    if (key === shown) {
      if (bar) bar.style.transform = `scaleX(${progress.toFixed(3)})`;
      return;
    }
    shown = key;

    if (s.qrBits && s.qrBits !== drawnQr) {
      drawnQr = s.qrBits;
      drawQr(qr, s.qrSize, s.qrBits);
    }
    const showSign = s.qrBits !== "" && (s.stage === "waiting" || s.stage === "connected" || s.stage === "done");
    sign.classList.toggle("on", showSign);
    sign.classList.toggle("used", s.stage === "connected" || s.stage === "done");
    card.classList.toggle("asking", s.stage === "ask");

    const title = s.mode === "send" ? t("Send to phone") : t("Get from phone");
    clear(text);
    const buttons = h("div", { class: "actions" });
    const cancel = h("button", { class: "btn secondary", text: tl("Cancel"), onclick: () => actions.phoneClose() });

    switch (s.stage) {
      case "starting":
        text.append(line("title", title), line("sub", "…"));
        buttons.append(cancel);
        break;
      case "ask":
        text.append(
          line("title", t("Is this network yours?")),
          line("sub", t("Your home's, or your phone's hotspot? Not a café's, school's or hotel's?")),
          line("phone-note", t("Both on the same Wi-Fi. Everything goes sealed end to end.")),
        );
        buttons.append(
          h("button", { class: "btn primary", text: tl("Yes, it's mine"), onclick: () => actions.phoneTrust() }),
          cancel,
        );
        break;
      case "waiting": {
        const until = new Date(s.until).toLocaleTimeString(language(), { hour: "2-digit", minute: "2-digit" });
        text.append(
          line("title", title),
          line("sub", t("Scan it with your phone's camera")),
          line("phone-note", t("Both on the same Wi-Fi. Everything goes sealed end to end.")),
        );
        if (hotspotHint) text.append(line("phone-note warn", t("The phone can't reach this computer? Connect the computer to your phone's hotspot.")));
        else if (!firewallTold()) text.append(line("phone-note", t("If Windows asks, let Puhu use the network.")));
        text.append(line("phone-until", t("Until {time}", { time: until })));
        buttons.append(cancel);
        break;
      }
      case "connected":
        text.append(line("title", title), line("sub ok", t("{device} is connected", { device: s.device })));
        if (s.mode === "send") {
          const total = s.files.reduce((n, f) => n + f.size, 0);
          text.append(
            line("phone-note", `${tn("{count} file", "{count} files", s.files.length)}${total > 0 ? ` · ${bytes(total)}` : ""}`),
            h("div", { class: "phone-bar" }, h("i")),
          );
          buttons.append(cancel);
        } else {
          const list = h("div", { class: "phone-list" });
          for (const name of s.received.slice(-3)) list.append(h("div", { class: "phone-got", text: name, title: name }));
          text.append(list, h("div", { class: "phone-bar" }, h("i")));
          if (s.received.length > 0) {
            text.append(line("phone-note ok", t("Saved in Downloads")));
            buttons.append(h("button", { class: "btn secondary", text: tl("Show in Downloads"), onclick: () => actions.phoneDownloads() }));
          }
          buttons.append(h("button", { class: "btn primary", text: tl("Done"), onclick: () => actions.phoneClose() }));
        }
        break;
      case "done":
        text.append(line("title", title), line("sub ok", t("Sent")));
        if (flown !== s) {
          flown = s;
          fly();
        }
        break;
      case "ended":
      case "error":
        text.append(line("title", title));
        if (s.received.length > 0) {
          text.append(line("sub ok", tn("{count} file", "{count} files", s.received.length)), line("phone-note ok", t("Saved in Downloads")));
          buttons.append(h("button", { class: "btn secondary", text: tl("Show in Downloads"), onclick: () => actions.phoneDownloads() }));
        }
        if (s.note) text.append(line("sub warn", s.note));
        buttons.append(h("button", { class: "btn primary", text: tl("OK"), onclick: () => actions.phoneClose() }));
        break;
    }
    if (buttons.childElementCount > 0) text.append(buttons);
    const barNow = text.querySelector<HTMLElement>(".phone-bar i");
    if (barNow) barNow.style.transform = `scaleX(${progress.toFixed(3)})`;
  }

  return {
    el,
    sync() {
      const s = State.phone;
      if (!s) return;
      // Nobody connected for a while: perhaps the network keeps them apart.
      if (s.stage === "waiting" && !hintTimer && !hotspotHint) {
        hintTimer = window.setTimeout(() => {
          hintTimer = 0;
          if (State.phone === s && s.stage === "waiting") {
            hotspotHint = true;
            draw(s);
          }
        }, HOTSPOT_HINT_MS);
      }
      if (s.stage !== "waiting") {
        window.clearTimeout(hintTimer);
        hintTimer = 0;
        hotspotHint = false;
      }
      if (s.stage === "connected") {
        try {
          localStorage.setItem(FIREWALL_TOLD_KEY, "1");
        } catch {
          // Said again next time.
        }
      }
      draw(s);
    },
  };
}
