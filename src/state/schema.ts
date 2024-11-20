import { createSchema, slice } from "starfx";

export const [schema, initialState] = createSchema({
  cache: slice.table({ empty: {} }),
  loaders: slice.loaders<any>(),
  test: slice.obj({
    keyA: "A",
    key1: "",
    key2: "",
  }),
  tableA: slice.table({
    empty: {},
    initialState: {},
  }),
  tableB: slice.table({
    empty: {},
    initialState: {},
  }),
});
