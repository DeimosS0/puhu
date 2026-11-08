// USB drives plugged in (src-tauri/src/usb.rs): each with its name, a bar of how full it
// is and how much room is left, Open and Eject safely. Ejected, the stick slides up and
// out of its row and the row says it can be taken out, for a moment, before it goes.

import { h, svg } from "./dom";
import { Bridge, type UsbDrive } from "../core/bridge";
import { State } from "../core/state";
import { language, N_, t, tl } from "../i18n/i18n";
import type { ViewActions, ViewHost } from "./views";

/** A USB stick: its body, its plug, the plug's two holes. */
export const USB_ICON = "M9 2.5h6v5H9zM6.5 7.5h11V18a3.5 3.5 0 0 1-3.5 3.5h-4A3.5 3.5 0 0 1 6.5 18zM10.8 4.6v.8M13.2 4.6v.8";
/** How long a row says it can be taken out before it goes. */
const FAREWELL_MS = 2600;

export function bytes(n: number): string {
  const gb = n / 1024 ** 3;
  if (gb >= 1) return `${new Intl.NumberFormat(language(), { maximumFractionDigits: gb < 10 ? 1 : 0 }).format(gb)} GB`;
  return `${Math.max(1, Math.round(n / 1024 ** 2))} MB`;
}

export function driveName(d: UsbDrive): string {
  return `${d.label || t(N_("USB drive"))} (${d.letter}:)`;
}

export function buildUsb(actions: ViewActions): ViewHost {
  const list = h("div", { class: "usb-list" });
  const el = h("div", { class: "view" }, h("div", { class: "card" }, h("div", { class: "stack usb-stack" }, list)));

  /** Ejected ones, still shown for a moment: letter → the drive and when. */
  const farewell = new Map<string, { drive: UsbDrive; at: number }>();
  /** Being ejected, and those refused (why). */
  const ejecting = new Set<string>();
  const refused = new Map<string, string>();
  let shownFor = "";

  const eject = (d: UsbDrive) => {
    ejecting.add(d.letter);
    refused.delete(d.letter);
    draw(true);
    Bridge.usbEject(d.letter)
      .then(() => {
        farewell.set(d.letter, { drive: d, at: Date.now() });
        actions.usbEjected();
        window.setTimeout(() => {
          farewell.delete(d.letter);
          draw(true);
        }, FAREWELL_MS);
      })
      .catch((err) => {
        refused.set(d.letter, String(err).replace(/^Error:\s*/, ""));
        window.setTimeout(() => {
          refused.delete(d.letter);
          draw(true);
        }, 5000);
      })
      .finally(() => {
        ejecting.delete(d.letter);
        draw(true);
      });
  };

  const row = (d: UsbDrive, gone: boolean) => {
    const stick = h("span", { class: "usb-stick" }, svg(USB_ICON, 20, { stroke: 1.7 }));
    const used = d.total > 0 ? 1 - d.free / d.total : 0;
    const bar = h("div", { class: "usb-bar" }, h("i", { style: `transform:scaleX(${used.toFixed(3)})` }));
    const note = refused.get(d.letter);
    const info = h(
      "div",
      { class: "usb-info" },
      h("div", { class: "title", text: driveName(d) }),
      gone
        ? h("div", { class: "sub ok", text: t("You can take it out") })
        : note
          ? h("div", { class: "sub warn", text: note })
          : h("div", { class: "sub", text: t("{free} free of {total}", { free: bytes(d.free), total: bytes(d.total) }) }),
      gone ? null : bar,
    );
    const busy = ejecting.has(d.letter);
    const buttons = gone
      ? null
      : h(
          "div",
          { class: "actions" },
          h("button", { class: "btn primary", text: tl("Open"), onclick: () => void Bridge.usbOpen(d.letter) }),
          h("button", { class: "btn secondary", text: busy ? tl("Ejecting…") : tl("Eject safely"), disabled: busy, onclick: () => eject(d) }),
        );
    const el = h("div", { class: `usb-row${gone ? " gone" : ""}` }, stick, info, buttons);
    if (gone) {
      // Out of its row: up and away, as it would come out of the port.
      stick.animate(
        [{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-6px)", opacity: 1, offset: 0.3 }, { transform: "translateY(-30px)", opacity: 0 }],
        { duration: 700, easing: "cubic-bezier(0.4, 0, 0.6, 1)", fill: "forwards" },
      );
    }
    return el;
  };

  const draw = (force = false) => {
    const drives = State.usbDrives.filter((d) => !farewell.has(d.letter));
    const key = [
      ...drives.map((d) => `${d.letter}:${d.free}:${ejecting.has(d.letter)}:${refused.get(d.letter) ?? ""}`),
      ...[...farewell.keys()].map((l) => `bye-${l}`),
    ].join("|");
    if (!force && key === shownFor) return;
    shownFor = key;
    list.replaceChildren(...drives.map((d) => row(d, false)), ...[...farewell.values()].map((f) => row(f.drive, true)));
  };

  return {
    el,
    sync() {
      draw();
    },
  };
}
