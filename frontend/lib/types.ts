// Names for the API's shapes, over the types generated from the committed
// openapi.json (`npm run gen:api`). Never hand-write an API shape: if one is missing
// or wrong, the contract is fixed in commercelab/api/models.py and regenerated.

import type { components } from "./api-types";

type Schemas = components["schemas"];

export type ProductCard = Schemas["ProductCardOut"];
export type ProductDetail = Schemas["ProductDetailOut"];
export type ProductPage = Schemas["ProductPage"];
export type Category = Schemas["CategoryOut"];
export type Collection = Schemas["CollectionOut"];
export type CollectionDetail = Schemas["CollectionDetailOut"];
export type CartQuote = Schemas["CartQuoteOut"];
export type CartLineQuote = Schemas["CartLineOut"];
export type Order = Schemas["OrderOut"];
export type CheckoutRequest = Schemas["CheckoutRequest"];
export type InsufficientStock = Schemas["InsufficientStockOut"];
export type Image = Schemas["ImageOut"];
