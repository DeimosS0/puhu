// Drop zone, upload progress and the "what do you want to do with it" card.
//
// Sending a file by email is not in the Windows v1, so `choose` offers a question about
// it and, for photos, a Word document or plain text, what they can be made into
// (island/convert.ts).

import { h, clear, svg } from "./dom";
import { ICONS } from "./icons";
import { PHONE_ICON } from "./phone";
import { State } from "../core/state";
import { offers, onePicture, type ConvertKind } from "../island/convert";
import type { ViewActions, ViewHost } from "./views";
import { N_, language, t, tl } from "../i18n/i18n";

const MAKE: Record<ConvertKind, string> = {
  pdf: N_("Make a PDF"),
  small: N_("Make it smaller"),
  jpg: N_("Make a JPG"),
};

/** Dashed rounded rect drawn as SVG so the dashes can march. */
function dashedFrame(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const el = document.createElementNS(ns, "svg");
  el.setAttribute("class", "drop-frame");
  el.setAttribute("preserveAspectRatio", "none");
  const rect = document.createElementNS(ns, "rect");
  rect.setAttribute("x", "0.75");
  rect.setAttribute("y", "0.75");
  rect.setAttribute("width", "calc(100% - 1.5px)");
  rect.setAttribute("height", "calc(100% - 1.5px)");
  rect.setAttribute("rx", "20");
  rect.setAttribute("fill", "none");
  rect.setAttribute("stroke-width", "1.5");
  rect.setAttribute("stroke-dasharray", "6 5");
  el.append(rect);
  return el;
}

export function buildUpload(actions: ViewActions): ViewHost {
  const frame = dashedFrame();
  const title = h("div", { class: "drop-title", text: tl("Drop your files here") });
  const tags = h(
    "div",
    { class: "drop-tags" },
    ...[N_("PDF"), N_("Images"), N_("Code"), N_("Docs")].map((chip) => h("span", { text: tl(chip) })),
  );
  const card = h(
    "div",
    { class: "card drop-card" },
    frame,
    h("div", { class: "drop-body" }, title, tags,
      // Or the other way: files from a phone (island/phone.ts).
      h("div", { class: "drop-more" },
        h("button", { class: "btn secondary drop-phone", onclick: () => actions.phoneReceive() },
          svg(PHONE_ICON, 13, { stroke: 1.8 }), h("span", { text: tl("Get from phone") })))),
  );
  const el = h("div", { class: "view" }, card);

  return {
    el,
    sync() {
      card.classList.toggle("over", State.fileDragOver);
    },
  };
}

export function buildUploading(): ViewHost {
  const label = h("span", { class: "up-name" });
  const percent = h("span", { class: "up-pct" });
  const fill = h("div", { class: "up-fill" });
  const glow = h("div", { class: "up-glow" });
  const card = h(
    "div",
    { class: "card up-card" },
    h("div", { class: "up-row" }, label, percent),
    h("div", { class: "up-track" }, fill, glow),
  );
  const el = h("div", { class: "view" }, card);

  return {
    el,
    sync() {
      const done = State.uploadProgress >= 0.999;
      const pct = Math.round(State.uploadProgress * 100);
      label.textContent = done
        ? `✓  ${State.droppedFile?.name ?? t("File")}`
        : t("Uploading {name}", { name: State.droppedFile?.name ?? t("file") });
      label.classList.toggle("done", done);
      percent.textContent = done ? "" : `${pct} %`;
      const w = State.uploadProgress * 526;
      fill.style.width = `${w}px`;
      glow.style.transform = `translateX(${Math.max(0, w - 14)}px)`;
      glow.style.opacity = State.uploadProgress > 0.01 ? "1" : "0";
      card.classList.toggle("done", done);
    },
  };
}

export function buildChoose(actions: ViewActions): ViewHost {
  const title = h("div", { class: "title" });
  const sub = h("div", { class: "sub" });
  // Where a language's words leave no room for the whole row, it keeps only its bubble.
  const ask = h(
    "button",
    { class: "btn primary choose-ask", title: tl("Ask a question"), onclick: () => actions.setView("prompt") },
    svg(ICONS.bubbleRound, 14),
    h("span", { text: tl("Ask a question") }),
  );
  const cancel = h("button", { class: "btn secondary", text: tl("Cancel"), onclick: () => actions.cancelDrop() });
  // With something to make, Cancel steps aside to the corner and leaves the row to the actions.
  const close = h("button", { class: "card-x", title: t("Cancel"), onclick: () => actions.cancelDrop() }, svg(ICONS.xmark, 10));
  const row = h("div", { class: "actions choose-actions" }, ask, cancel);
  const el = h(
    "div",
    { class: "view" },
    h(
      "div",
      { class: "card" },
      close,
      h("div", { class: "stack", style: "padding:0 18px 0 98px" }, title, sub, row),
    ),
  );
  let shownFor = "";

  return {
    el,
    sync() {
      const paths = State.droppedPaths;
      clear(title);
      if (paths.length > 1) {
        title.textContent = t("{n} files are ready.", { n: paths.length });
      } else {
        title.append(
          h("b", { text: State.droppedFile?.name ?? t("file") }),
          document.createTextNode(t(" is ready.")),
        );
      }
      sub.textContent = paths.length > 1 ? t("What do you want to do with them?") : t("What do you want to do with it?");
      const kinds = offers(paths);
      const picture = onePicture(paths);
      const key = `${kinds.join()}|${paths.length}|${picture}|${language()}`;
      if (key === shownFor) return;
      shownFor = key;
      const makes = kinds.map((kind, i) =>
        h("button", { class: `btn ${i === 0 ? "primary" : "secondary"}`, text: tl(MAKE[kind]), onclick: () => actions.convert(kind) }),
      );
      if (picture) makes.push(h("button", { class: "btn secondary", text: tl("Copy text"), onclick: () => actions.pictureText() }));
      ask.classList.toggle("primary", makes.length === 0);
      ask.classList.toggle("secondary", makes.length > 0);
      row.replaceChildren(...makes, ask, ...(makes.length ? [] : [cancel]));
      row.classList.remove("tight");
      requestAnimationFrame(() => row.classList.toggle("tight", row.scrollWidth > row.clientWidth + 1));
      close.hidden = makes.length === 0;
    },
  };
}
