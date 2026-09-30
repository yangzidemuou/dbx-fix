// @vitest-environment happy-dom

import { createApp, defineComponent, h, markRaw, nextTick, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { QueryResult } from "@/types/database";
import { TooltipProvider } from "@/components/ui/tooltip";

// Regression coverage for #10711 / #10709 / #10702: the tooltip wrapper added in
// 6ffc46279 must not swallow the clicks of the wrapped toolbar triggers.
vi.mock("vue-virtual-scroller", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    RecycleScroller: defineComponent({
      props: { items: { type: Array, default: () => [] } },
      setup(props, { attrs, slots }) {
        return () =>
          h(
            "div",
            attrs,
            props.items.map((item) => slots.default?.({ item })),
          );
      },
    }),
  };
});

vi.mock("@/composables/useDataGridColumnResize", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/composables/useDataGridColumnResize")>();
  const { ref } = await import("vue");
  return {
    ...actual,
    useDataGridColumnResize: () => ({
      initColumnWidths: vi.fn(),
      onResizeStart: vi.fn(),
      autoFitColumn: vi.fn(),
      renderedColumnWidths: ref([120]),
      totalWidth: ref(120),
      columnVars: ref({ "--total-w": "120px" }),
      getIsResizing: () => false,
    }),
  };
});

import DataGrid from "../DataGrid.vue";
import { useSettingsStore } from "@/stores/settingsStore";

const mountedApps: Array<{ app: App; host: HTMLElement }> = [];

function mountToolbar() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const settingsStore = useSettingsStore();
  settingsStore.updateEditorSettings({ dataGridRenderMode: "dom" });
  const result = markRaw<QueryResult>({
    columns: ["id"],
    rows: [[1]],
    affected_rows: 0,
    execution_time_ms: 0,
  });
  const host = document.createElement("div");
  document.body.append(host);
  const Root = defineComponent({
    setup() {
      return () => h(TooltipProvider, { delayDuration: 0 }, { default: () => h(DataGrid, { result, databaseType: "mysql", context: "table-data" }) });
    },
  });
  const app = createApp(Root);
  app.use(pinia);
  app.use(i18n);
  app.component(
    "RecycleScroller",
    defineComponent({
      props: { items: { type: Array, default: () => [] } },
      setup(props, { attrs, slots }) {
        return () =>
          h(
            "div",
            attrs,
            props.items.map((item) => slots.default?.({ item })),
          );
      },
    }),
  );
  app.mount(host);
  const mounted = { app, host };
  mountedApps.push(mounted);
  return mounted;
}

async function settle() {
  await nextTick();
  await Promise.resolve();
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await nextTick();
}

function toolbarButton(host: HTMLElement, action: string): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>(`[data-toolbar-action="${action}"]`);
  if (!button) throw new Error(`Toolbar button ${action} not found`);
  return button;
}

// A real user click is pointerdown → pointerup → click; dispatching only
// "click" would skip the tooltip trigger's pointerdown handling.
async function clickButton(button: HTMLElement) {
  button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse", button: 0 }));
  button.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerType: "mouse", button: 0 }));
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  await settle();
}

function popoverSearchInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>("input[placeholder='Search column/comment...']");
}

function dropdownMenuItems(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const { app, host } of mountedApps.splice(0)) {
    app.unmount();
    host.remove();
  }
  document.body.innerHTML = "";
});

describe("data grid toolbar trigger clicks survive the tooltip wrapper", () => {
  it("opens the go-to-column popover when the navigation button is clicked", async () => {
    const { host } = mountToolbar();
    await settle();

    await clickButton(toolbarButton(host, "navigation"));

    expect(popoverSearchInput()).not.toBeNull();
  });

  it("opens the auto refresh dropdown menu when the button is clicked", async () => {
    const { host } = mountToolbar();
    await settle();

    await clickButton(toolbarButton(host, "autoRefresh"));

    expect(dropdownMenuItems().length).toBeGreaterThan(0);
  });
});
