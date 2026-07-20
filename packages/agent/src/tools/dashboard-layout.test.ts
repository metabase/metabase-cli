import { expect, test } from "vitest";
import {
  buildEditableLayout,
  type CardFacts,
  compileDashboardLayout,
  type DashboardState,
  type LayoutContext,
  type LinkEntity,
  parseLayout,
  type TemplateTagKind,
} from "./dashboard-layout";
import { TeachingError } from "./teaching-error";

function context(
  cards: Record<number, CardFacts> = {},
  linkEntities: Record<string, LinkEntity> = {},
): LayoutContext {
  return {
    cards: new Map(Object.entries(cards).map(([id, facts]) => [Number(id), facts])),
    linkEntities: new Map(Object.entries(linkEntities)),
  };
}

function card(display = "table", tags: Record<string, TemplateTagKind> = {}): CardFacts {
  return { display, templateTags: new Map(Object.entries(tags)) };
}

const EMPTY_STATE: DashboardState = { dashcards: [], tabs: [], parameters: [] };

test("compiles a heading, a card, and a wired filter into one write", () => {
  const layout = parseLayout({
    parameters: [{ id: "created_at", name: "Created At", type: "date/all-options" }],
    dashcards: [
      { heading: "Q3" },
      { card_id: 10, parameter_mappings: [{ parameter_id: "created_at", target_field: 1779 }] },
    ],
  });

  const compiled = compileDashboardLayout(layout, null, context({ 10: card("line") }));

  expect(compiled).toEqual({
    tabs: [],
    parameters: [
      {
        id: "created_at",
        name: "Created At",
        slug: "created_at",
        type: "date/all-options",
        sectionId: "date",
      },
    ],
    dashcards: [
      {
        id: -1,
        card_id: null,
        action_id: null,
        dashboard_tab_id: null,
        row: 0,
        col: 0,
        size_x: 24,
        size_y: 1,
        visualization_settings: {
          "dashcard.background": false,
          virtual_card: {
            name: null,
            display: "heading",
            visualization_settings: {},
            dataset_query: {},
            archived: false,
          },
          text: "Q3",
        },
        parameter_mappings: [],
        inline_parameters: [],
        series: [],
      },
      {
        id: -2,
        card_id: 10,
        action_id: null,
        dashboard_tab_id: null,
        row: 1,
        col: 0,
        size_x: 12,
        size_y: 6,
        visualization_settings: {},
        parameter_mappings: [
          {
            parameter_id: "created_at",
            card_id: 10,
            target: ["dimension", ["field", 1779, null]],
          },
        ],
        inline_parameters: [],
        series: [],
      },
    ],
  });
});

test("new tabs carry negative ids that dashcards reference", () => {
  const layout = parseLayout({
    tabs: [{ id: -1, name: "Overview" }, { name: "Detail" }],
    dashcards: [{ card_id: 10 }, { card_id: 10, tab_id: -2 }],
  });

  const compiled = compileDashboardLayout(layout, null, context({ 10: card() }));

  expect(compiled.tabs).toEqual([
    { id: -1, name: "Overview" },
    { id: -2, name: "Detail" },
  ]);
  expect(compiled.dashcards.map((dashcard) => dashcard.dashboard_tab_id)).toEqual([-1, -2]);
});

test("explicit positions are kept and autoplaced cards fill around them", () => {
  const layout = parseLayout({
    dashcards: [
      { card_id: 10, row: 0, col: 12, size_x: 12, size_y: 6 },
      { card_id: 10, size_x: 12, size_y: 6 },
      { card_id: 10, size_x: 12, size_y: 6 },
    ],
  });

  const compiled = compileDashboardLayout(layout, null, context({ 10: card() }));

  expect(compiled.dashcards.map(({ row, col }) => ({ row, col }))).toEqual([
    { row: 0, col: 12 },
    { row: 0, col: 0 },
    { row: 6, col: 0 },
  ]);
});

test("a template-tag mapping binds by the tag's declared kind", () => {
  const layout = parseLayout({
    parameters: [{ id: "state", name: "State", type: "string/=" }],
    dashcards: [
      { card_id: 7, parameter_mappings: [{ parameter_id: "state", target_tag: "state" }] },
    ],
  });

  const compiled = compileDashboardLayout(
    layout,
    null,
    context({ 7: card("table", { state: "dimension" }) }),
  );

  expect(compiled.dashcards[0]?.parameter_mappings).toEqual([
    { parameter_id: "state", card_id: 7, target: ["dimension", ["template-tag", "state"]] },
  ]);
});

test("a text card maps a parameter as a text-tag", () => {
  const layout = parseLayout({
    parameters: [{ id: "state", name: "State", type: "string/=" }],
    dashcards: [
      {
        text: "Hello {{state}}",
        parameter_mappings: [{ parameter_id: "state", target_tag: "state" }],
      },
    ],
  });

  const compiled = compileDashboardLayout(layout, null, context());

  expect(compiled.dashcards[0]?.parameter_mappings).toEqual([
    { parameter_id: "state", card_id: null, target: ["text-tag", "state"] },
  ]);
});

test("an unknown template tag names the ones the card declares", () => {
  const layout = parseLayout({
    parameters: [{ id: "state", name: "State", type: "string/=" }],
    dashcards: [
      { card_id: 7, parameter_mappings: [{ parameter_id: "state", target_tag: "region" }] },
    ],
  });

  expect(() =>
    compileDashboardLayout(layout, null, context({ 7: card("table", { state: "dimension" }) })),
  ).toThrow('dashcards[0]: card 7 has no template tag "region" — it declares `state`.');
});

test("a mapping to an unknown parameter lists the declared ones", () => {
  const layout = parseLayout({
    parameters: [{ id: "state", name: "State", type: "string/=" }],
    dashcards: [{ card_id: 7, parameter_mappings: [{ parameter_id: "created", target_field: 1 }] }],
  });

  expect(() => compileDashboardLayout(layout, null, context({ 7: card() }))).toThrow(
    'dashcards[0]: parameter_mappings names parameter "created", which is not a parameter in this layout — the layout declares "state".',
  );
});

test("an unreadable card names the dashcard that references it", () => {
  const layout = parseLayout({ dashcards: [{ card_id: 99 }] });

  expect(() => compileDashboardLayout(layout, null, context())).toThrow(TeachingError);
  expect(() => compileDashboardLayout(layout, null, context())).toThrow(
    "dashcards[0]: card 99 does not exist or is not readable.",
  );
});

test("a dashcard without a content source is rejected", () => {
  const layout = parseLayout({ dashcards: [{ row: 0, col: 0 }] });

  expect(() => compileDashboardLayout(layout, null, context())).toThrow(
    "dashcards[0]: a dashcard needs a content source — one of card_id, text, heading, link, iframe, action_id.",
  );
});

test("two content sources on one dashcard are rejected", () => {
  const layout = parseLayout({ dashcards: [{ card_id: 10, text: "hi" }] });

  expect(() => compileDashboardLayout(layout, null, context({ 10: card() }))).toThrow(
    "dashcards[0]: provide exactly one content source (card_id, text, heading, link, iframe, action_id); received 2.",
  );
});

test("a position that runs off the grid is rejected", () => {
  const layout = parseLayout({
    dashcards: [{ card_id: 10, row: 0, col: 20, size_x: 12, size_y: 6 }],
  });

  expect(() => compileDashboardLayout(layout, null, context({ 10: card() }))).toThrow(
    "dashcards[0]: position (row 0, col 20) with size_x 12 runs off the 24-column grid.",
  );
});

test("row without col is rejected", () => {
  const layout = parseLayout({ dashcards: [{ card_id: 10, row: 3 }] });

  expect(() => compileDashboardLayout(layout, null, context({ 10: card() }))).toThrow(
    "dashcards[0]: `row` and `col` come together — provide both for an explicit position, or neither to autoplace.",
  );
});

test("a positive dashcard id must exist on the dashboard being updated", () => {
  const layout = parseLayout({ dashcards: [{ id: 41, card_id: 10 }] });

  expect(() => compileDashboardLayout(layout, EMPTY_STATE, context({ 10: card() }))).toThrow(
    "dashcards[0]: dashcard 41 is not on this dashboard — pull the current layout to see its dashcards, or drop `id` to add a new card.",
  );
});

test("a positive dashcard id on create is rejected", () => {
  const layout = parseLayout({ dashcards: [{ id: 41, card_id: 10 }] });

  expect(() => compileDashboardLayout(layout, null, context({ 10: card() }))).toThrow(
    "dashcards[0]: a create starts from an empty dashboard — drop `id` 41.",
  );
});

test("a link dashcard resolves its entity through the context", () => {
  const layout = parseLayout({
    dashcards: [{ link: { entity: { type: "question", id: 5 } } }],
  });
  const entity: LinkEntity = { id: 5, model: "card", name: "Orders" };

  const compiled = compileDashboardLayout(layout, null, context({}, { "question:5": entity }));

  expect(compiled.dashcards[0]?.visualization_settings).toEqual({
    virtual_card: {
      name: null,
      display: "link",
      visualization_settings: {},
      dataset_query: {},
      archived: false,
    },
    link: { entity },
  });
});

test("an inline parameter can live on only one card", () => {
  const layout = parseLayout({
    parameters: [{ id: "state", name: "State", type: "string/=" }],
    dashcards: [
      { card_id: 10, inline_parameters: ["state"] },
      { card_id: 10, inline_parameters: ["state"] },
    ],
  });

  expect(() => compileDashboardLayout(layout, null, context({ 10: card() }))).toThrow(
    'dashcards[1]: parameter "state" is already inline on dashcards[0] — a parameter lives on one card or in the header, not both.',
  );
});

test("a malformed layout names the failing path", () => {
  expect(() => parseLayout({ dashcards: [{ card_id: "ten" }] })).toThrow(TeachingError);
  expect(() => parseLayout({ dashcards: [{ card_id: "ten" }] })).toThrow(
    "layout.dashcards[0].card_id:",
  );
});

test("an unknown key in a dashcard is rejected, not silently dropped", () => {
  expect(() => parseLayout({ dashcards: [{ card_id: 10, sizeX: 4 }] })).toThrow(
    "layout.dashcards[0]:",
  );
});

test("pull produces a document that compiles back to the same canvas", () => {
  const state: DashboardState = {
    tabs: [
      { id: 7, dashboard_id: 3, name: "Overview" },
      { id: 8, dashboard_id: 3, name: "Detail" },
    ],
    parameters: [
      {
        id: "created_at",
        name: "Created At",
        slug: "created_at",
        type: "date/all-options",
        sectionId: "date",
      },
    ],
    dashcards: [
      {
        id: 41,
        dashboard_id: 3,
        card_id: 10,
        dashboard_tab_id: 7,
        row: 1,
        col: 0,
        size_x: 12,
        size_y: 6,
        entity_id: null,
        visualization_settings: { "card.title": "Orders" },
        parameter_mappings: [
          {
            parameter_id: "created_at",
            card_id: 10,
            target: ["dimension", ["field", 1779, null]],
          },
        ],
        inline_parameters: [],
        series: [{ id: 11 }],
      },
      {
        id: 42,
        dashboard_id: 3,
        card_id: null,
        dashboard_tab_id: 8,
        row: 0,
        col: 0,
        size_x: 24,
        size_y: 1,
        entity_id: null,
        visualization_settings: {
          "dashcard.background": false,
          virtual_card: {
            name: null,
            display: "heading",
            visualization_settings: {},
            dataset_query: {},
            archived: false,
          },
          text: "Q3",
        },
        parameter_mappings: [],
        inline_parameters: [],
      },
    ],
  };

  const layout = buildEditableLayout(state);

  expect(layout).toEqual({
    tabs: [
      { id: 7, name: "Overview" },
      { id: 8, name: "Detail" },
    ],
    parameters: [
      {
        id: "created_at",
        name: "Created At",
        slug: "created_at",
        type: "date/all-options",
        sectionId: "date",
      },
    ],
    dashcards: [
      {
        id: 41,
        card_id: 10,
        tab_id: 7,
        row: 1,
        col: 0,
        size_x: 12,
        size_y: 6,
        series: [11],
        visualization_settings: { "card.title": "Orders" },
        parameter_mappings: [
          { parameter_id: "created_at", target: ["dimension", ["field", 1779, null]] },
        ],
      },
      { id: 42, heading: "Q3", tab_id: 8, row: 0, col: 0, size_x: 24, size_y: 1 },
    ],
  });

  const compiled = compileDashboardLayout(
    parseLayout(layout),
    state,
    context({ 10: card("line"), 11: card("line") }),
  );

  expect(compiled).toEqual({
    tabs: [
      { id: 7, name: "Overview" },
      { id: 8, name: "Detail" },
    ],
    parameters: [
      {
        id: "created_at",
        name: "Created At",
        slug: "created_at",
        type: "date/all-options",
        sectionId: "date",
      },
    ],
    dashcards: [
      {
        id: 41,
        card_id: 10,
        action_id: null,
        dashboard_tab_id: 7,
        row: 1,
        col: 0,
        size_x: 12,
        size_y: 6,
        visualization_settings: { "card.title": "Orders" },
        parameter_mappings: [
          {
            parameter_id: "created_at",
            card_id: 10,
            target: ["dimension", ["field", 1779, null]],
          },
        ],
        inline_parameters: [],
        series: [{ id: 11 }],
      },
      {
        id: 42,
        card_id: null,
        action_id: null,
        dashboard_tab_id: 8,
        row: 0,
        col: 0,
        size_x: 24,
        size_y: 1,
        visualization_settings: {
          "dashcard.background": false,
          virtual_card: {
            name: null,
            display: "heading",
            visualization_settings: {},
            dataset_query: {},
            archived: false,
          },
          text: "Q3",
        },
        parameter_mappings: [],
        inline_parameters: [],
        series: [],
      },
    ],
  });
});

test("a parameter without an id gets a slug id, sectionId, and slug minted", () => {
  const layout = parseLayout({
    parameters: [{ name: "Created At", type: "date/all-options" }],
    dashcards: [],
  });

  const compiled = compileDashboardLayout(layout, null, context());

  expect(compiled.parameters).toEqual([
    {
      id: "created_at",
      name: "Created At",
      slug: "created_at",
      type: "date/all-options",
      sectionId: "date",
    },
  ]);
});
