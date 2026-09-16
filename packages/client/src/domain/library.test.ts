import { describe, expect, it } from "vitest";

import { evaluateFeatures, type Features } from "../version/features";

import { type LibraryCollectionInfo, libraryWireSchema, toLibrary } from "./library";

const CHILDREN_WITHOUT_TYPE = evaluateFeatures(61, { library: true });
const CHILDREN_WITH_TYPE = evaluateFeatures(62, { library: true });

const ROOT = { id: 10, name: "Library", type: "library", description: null, location: "/" };

const BARE_CHILDREN = [
  { id: 11, name: "Data", description: null },
  { id: 12, name: "Metrics", description: null },
];

const LISTING: ReadonlyMap<number, LibraryCollectionInfo> = new Map([
  [11, { id: 11, type: "library-data", is_remote_synced: false }],
  [12, { id: 12, type: "library-metrics", is_remote_synced: true }],
]);

const LIBRARY = {
  ...ROOT,
  effective_children: [
    { id: 11, name: "Data", description: null, type: "library-data", is_remote_synced: false },
    {
      id: 12,
      name: "Metrics",
      description: null,
      type: "library-metrics",
      is_remote_synced: true,
    },
  ],
};

function readLibrary(features: Features, body: unknown) {
  const wire = libraryWireSchema(features).parse(body);
  if (wire === null) {
    throw new Error("expected a Library on the wire");
  }
  return toLibrary(wire, LISTING);
}

describe("libraryWireSchema and toLibrary", () => {
  it("fills both type and sync flag from the listing when the children carry neither", () => {
    expect(
      readLibrary(CHILDREN_WITHOUT_TYPE, { ...ROOT, effective_children: BARE_CHILDREN }),
    ).toEqual(LIBRARY);
  });

  it("fills only the sync flag from the listing when the children carry a type", () => {
    const typed = [
      { id: 11, name: "Data", description: null, type: "library-data" },
      { id: 12, name: "Metrics", description: null, type: "library-metrics" },
    ];

    expect(readLibrary(CHILDREN_WITH_TYPE, { ...ROOT, effective_children: typed })).toEqual(
      LIBRARY,
    );
  });

  it("keeps the wire's type over the listing's when the children carry one", () => {
    const disagreeing = [
      { id: 11, name: "Data", description: null, type: "library-metrics" },
      { id: 12, name: "Metrics", description: null, type: "library-data" },
    ];

    expect(readLibrary(CHILDREN_WITH_TYPE, { ...ROOT, effective_children: disagreeing })).toEqual({
      ...ROOT,
      effective_children: [
        {
          id: 11,
          name: "Data",
          description: null,
          type: "library-metrics",
          is_remote_synced: false,
        },
        {
          id: 12,
          name: "Metrics",
          description: null,
          type: "library-data",
          is_remote_synced: true,
        },
      ],
    });
  });

  it("reads null for what the listing does not describe", () => {
    const unlisted = [{ id: 99, name: "Elsewhere", description: null }];

    expect(readLibrary(CHILDREN_WITHOUT_TYPE, { ...ROOT, effective_children: unlisted })).toEqual({
      ...ROOT,
      effective_children: [
        { id: 99, name: "Elsewhere", description: null, type: null, is_remote_synced: null },
      ],
    });
  });

  it("never looks a non-numeric child id up in the listing", () => {
    const entityId = [
      { id: "NuFrFzRZgvqcMGjSjOOJH", name: "Data", description: null, type: "library-data" },
    ];

    expect(readLibrary(CHILDREN_WITH_TYPE, { ...ROOT, effective_children: entityId })).toEqual({
      ...ROOT,
      effective_children: [
        {
          id: "NuFrFzRZgvqcMGjSjOOJH",
          name: "Data",
          description: null,
          type: "library-data",
          is_remote_synced: null,
        },
      ],
    });
  });

  it("drops a type the wire carries on the generation whose children carry none", () => {
    expect(
      readLibrary(CHILDREN_WITHOUT_TYPE, {
        ...ROOT,
        effective_children: [
          { id: 99, name: "Elsewhere", description: null, type: "library-data" },
        ],
      }),
    ).toEqual({
      ...ROOT,
      effective_children: [
        { id: 99, name: "Elsewhere", description: null, type: null, is_remote_synced: null },
      ],
    });
  });

  it("reads an absent Library as null on either generation", () => {
    expect(libraryWireSchema(CHILDREN_WITHOUT_TYPE).parse({ data: null })).toBeNull();
    expect(libraryWireSchema(CHILDREN_WITH_TYPE).parse({ data: null })).toBeNull();
  });
});
