import { createCn } from "cn/config";

// Class merging that knows direction A's own tokens (app/globals.css). Without
// this, `cn("text-white text-callout")` would treat `text-callout` as a colour and
// drop `text-white`. Always import `cn` from here, never from "cn" directly.
export const cn = createCn({
  extend: {
    theme: {
      text: ["caption", "footnote", "callout", "body", "title-3", "title-2", "title-1", "headline"],
      radius: ["tile", "panel", "pill"],
      tracking: ["headline"],
    },
  },
});
