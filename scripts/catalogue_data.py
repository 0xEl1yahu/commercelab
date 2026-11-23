"""The catalogue's identity: categories, the 55 products and the collections.

Shared by the seed (scripts/seed.py), the image curation (scripts/image_manifest.json)
and the storefront's e2e tests, which look products up by the scenario skus
below. Prices, copy and specs live with the seed content, not here.

The brands are invented. Product names never repeat the brand ("Quill Low
Profile Wireless Keyboard" by Halden), and each slug is "<brand>-<name>",
slugified.

There are 54 active products, 9 per category, plus DISCONTINUED_SKU, which is
inactive (still referenced by old orders, so never deleted).
"""

# (slug, title, description), in nav order.
CATEGORIES: list[tuple[str, str, str]] = [
    ("keyboards", "Keyboards", "Low-profile, mechanical and compact."),
    ("mice", "Mice", "Quiet, ergonomic and precise."),
    ("monitors", "Monitors", "Sharp screens and the arms to hold them."),
    ("audio", "Audio", "Headsets, speakers and microphones for calls."),
    ("desk", "Desk", "Lamps, stands, mats and webcams."),
    ("cables", "Cables & docks", "Docks, hubs and the cables between them."),
]

# Scenario products that tests and the storefront depend on.
SPOTLIGHT_SKU = "HD-QUILL-GRY"  # the home page hero
LIMITED_SKU = "OR-H1-BLK"  # exactly 2 in stock
LOW_STOCK_SKUS = ("KS-ARC-WHT", "LM-ARC-LAMP")  # "Only N left"
SOLD_OUT_SKU = "MR-SLIM2-WHT"  # nothing on hand
DISCONTINUED_SKU = "MR-BUD1-BLK"  # inactive; outside the 9 per category

# (sku, slug, name, brand, category)
PRODUCTS: list[tuple[str, str, str, str, str]] = [
    # keyboards: Halden, Marlow, Tessel
    ("HD-QUILL-GRY", "halden-quill-low-profile-wireless-keyboard",
     "Quill Low Profile Wireless Keyboard", "Halden", "keyboards"),
    ("HD-K4-GRY", "halden-k4-full-size-low-profile-keyboard",
     "K4 Full Size Low Profile Keyboard", "Halden", "keyboards"),
    ("HD-S1-BLK", "halden-s1-split-ergonomic-keyboard",
     "S1 Split Ergonomic Keyboard", "Halden", "keyboards"),
    ("MR-SLIM2-WHT", "marlow-slim-2-wireless-keyboard",
     "Slim 2 Wireless Keyboard", "Marlow", "keyboards"),
    ("MR-QT87-BLK", "marlow-qt87-quiet-tenkeyless-keyboard",
     "QT87 Quiet Tenkeyless Keyboard", "Marlow", "keyboards"),
    ("MR-NP1-WHT", "marlow-np1-wireless-numeric-keypad",
     "NP1 Wireless Numeric Keypad", "Marlow", "keyboards"),
    ("TS-T75-GRY", "tessel-t75-mechanical-keyboard",
     "T75 Mechanical Keyboard", "Tessel", "keyboards"),
    ("TS-T100-BLK", "tessel-t100-full-size-mechanical-keyboard",
     "T100 Full Size Mechanical Keyboard", "Tessel", "keyboards"),
    ("TS-FOLD-BLK", "tessel-fold-travel-bluetooth-keyboard",
     "Fold Travel Bluetooth Keyboard", "Tessel", "keyboards"),

    # mice: Kestrel, Marlow
    ("KS-ARC-WHT", "kestrel-arcus-silent-wireless-mouse",
     "Arcus Silent Wireless Mouse", "Kestrel", "mice"),
    ("KS-V3-GRY", "kestrel-v3-vertical-ergonomic-mouse",
     "V3 Vertical Ergonomic Mouse", "Kestrel", "mice"),
    ("KS-P5-BLK", "kestrel-p5-precision-wireless-mouse",
     "P5 Precision Wireless Mouse", "Kestrel", "mice"),
    ("KS-TB2-GRY", "kestrel-tb2-wireless-trackball",
     "TB2 Wireless Trackball", "Kestrel", "mice"),
    ("KS-GLIDE-BLU", "kestrel-glide-compact-travel-mouse",
     "Glide Compact Travel Mouse", "Kestrel", "mice"),
    ("MR-M2-WHT", "marlow-m2-quiet-click-mouse",
     "M2 Quiet Click Mouse", "Marlow", "mice"),
    ("MR-W1-BLK", "marlow-w1-wired-office-mouse",
     "W1 Wired Office Mouse", "Marlow", "mice"),
    ("MR-L1-BLK", "marlow-l1-left-handed-ergonomic-mouse",
     "L1 Left Handed Ergonomic Mouse", "Marlow", "mice"),
    ("MR-PAD1-GRY", "marlow-pad-1-wireless-glass-trackpad",
     "Pad 1 Wireless Glass Trackpad", "Marlow", "mice"),

    # monitors: Aster (screens), Tessel (arms)
    ("AS-F24-BLK", "aster-f24-24-inch-full-hd-monitor",
     "F24 24-inch Full HD Monitor", "Aster", "monitors"),
    ("AS-Q27-BLK", "aster-q27-27-inch-qhd-monitor",
     "Q27 27-inch QHD Monitor", "Aster", "monitors"),
    ("AS-U27-SLV", "aster-u27-27-inch-4k-usb-c-monitor",
     "U27 27-inch 4K USB-C Monitor", "Aster", "monitors"),
    ("AS-U32-SLV", "aster-u32-32-inch-4k-monitor",
     "U32 32-inch 4K Monitor", "Aster", "monitors"),
    ("AS-W34-BLK", "aster-w34-34-inch-curved-ultrawide-monitor",
     "W34 34-inch Curved Ultrawide Monitor", "Aster", "monitors"),
    ("AS-P16-GRY", "aster-p16-16-inch-portable-usb-c-monitor",
     "P16 16-inch Portable USB-C Monitor", "Aster", "monitors"),
    ("TS-ARM1-BLK", "tessel-arm-1-single-monitor-arm",
     "Arm 1 Single Monitor Arm", "Tessel", "monitors"),
    ("TS-ARM2-BLK", "tessel-arm-2-dual-monitor-arm",
     "Arm 2 Dual Monitor Arm", "Tessel", "monitors"),
    ("TS-ARMHD-BLK", "tessel-arm-hd-heavy-duty-monitor-arm",
     "Arm HD Heavy Duty Monitor Arm", "Tessel", "monitors"),

    # audio: Orrin, Marlow (plus the discontinued Marlow headset)
    ("OR-H1-BLK", "orrin-h1-wireless-headset",
     "H1 Wireless Headset", "Orrin", "audio"),
    ("OR-H3-BLK", "orrin-h3-noise-cancelling-headphones",
     "H3 Noise Cancelling Headphones", "Orrin", "audio"),
    ("OR-E2-WHT", "orrin-e2-wireless-earbuds",
     "E2 Wireless Earbuds", "Orrin", "audio"),
    ("OR-S2-GRY", "orrin-s2-desktop-speakers",
     "S2 Desktop Speakers", "Orrin", "audio"),
    ("OR-C1-BLK", "orrin-c1-usb-conference-speakerphone",
     "C1 USB Conference Speakerphone", "Orrin", "audio"),
    ("MR-H2-BLK", "marlow-h2-usb-office-headset",
     "H2 USB Office Headset", "Marlow", "audio"),
    ("MR-H2M-BLK", "marlow-h2-mono-usb-headset",
     "H2 Mono USB Headset", "Marlow", "audio"),
    ("MR-MIC1-BLK", "marlow-mic-1-usb-condenser-microphone",
     "Mic 1 USB Condenser Microphone", "Marlow", "audio"),
    ("MR-BAR1-BLK", "marlow-bar-1-monitor-soundbar",
     "Bar 1 Monitor Soundbar", "Marlow", "audio"),
    ("MR-BUD1-BLK", "marlow-bud-1-wired-headset",
     "Bud 1 Wired Headset", "Marlow", "audio"),

    # desk: Lumi (lamps, webcams), Halden (mats, wrist rests), Tessel (stands)
    ("LM-ARC-LAMP", "lumi-arc-led-desk-lamp",
     "Arc LED Desk Lamp", "Lumi", "desk"),
    ("LM-BEAM-BLK", "lumi-beam-monitor-light-bar",
     "Beam Monitor Light Bar", "Lumi", "desk"),
    ("LM-C1-BLK", "lumi-c1-1080p-webcam",
     "C1 1080p Webcam", "Lumi", "desk"),
    ("HD-FELT-GRY", "halden-field-felt-desk-mat",
     "Field Felt Desk Mat", "Halden", "desk"),
    ("HD-LTHR-BRN", "halden-field-leather-desk-mat",
     "Field Leather Desk Mat", "Halden", "desk"),
    ("HD-REST-GRY", "halden-rest-memory-foam-wrist-rest",
     "Rest Memory Foam Wrist Rest", "Halden", "desk"),
    ("TS-LS1-SLV", "tessel-ls1-aluminium-laptop-stand",
     "LS1 Aluminium Laptop Stand", "Tessel", "desk"),
    ("TS-VS1-SLV", "tessel-vs1-vertical-laptop-stand",
     "VS1 Vertical Laptop Stand", "Tessel", "desk"),
    ("TS-DR1-BLK", "tessel-dr1-standing-desk-converter",
     "DR1 Standing Desk Converter", "Tessel", "desk"),

    # cables: Corda, Marlow
    ("CD-D12-GRY", "corda-d12-usb-c-docking-station",
     "D12 USB-C Docking Station", "Corda", "cables"),
    ("CD-H7-GRY", "corda-h7-7-port-usb-hub",
     "H7 7-Port USB Hub", "Corda", "cables"),
    ("CD-C2-BLK", "corda-c2-usb-c-cable-2m",
     "C2 USB-C Cable 2m", "Corda", "cables"),
    ("CD-HD2-BLK", "corda-hd2-hdmi-2-1-cable-2m",
     "HD2 HDMI 2.1 Cable 2m", "Corda", "cables"),
    ("CD-DP2-BLK", "corda-dp2-displayport-cable-2m",
     "DP2 DisplayPort Cable 2m", "Corda", "cables"),
    ("MR-T4-GRY", "marlow-t4-travel-usb-c-hub",
     "T4 Travel USB-C Hub", "Marlow", "cables"),
    ("MR-P65-WHT", "marlow-p65-65w-usb-c-charger",
     "P65 65W USB-C Charger", "Marlow", "cables"),
    ("MR-E1-GRY", "marlow-e1-usb-c-ethernet-adapter",
     "E1 USB-C Ethernet Adapter", "Marlow", "cables"),
    ("MR-A1-WHT", "marlow-a1-usb-c-to-usb-a-adapter",
     "A1 USB-C to USB-A Adapter", "Marlow", "cables"),
]

# (slug, title, description, skus in order)
COLLECTIONS: list[tuple[str, str, str, list[str]]] = [
    ("spotlight", "Spotlight", "The one to look at first.", [SPOTLIGHT_SKU]),
    ("featured", "Featured", "A few favourites from across the range.", [
        "TS-T75-GRY",   # keyboards
        "KS-P5-BLK",    # mice
        "AS-U27-SLV",   # monitors
        LIMITED_SKU,    # audio: only 2 left
        "OR-H3-BLK",    # audio
        "LM-BEAM-BLK",  # desk
        "TS-ARM1-BLK",  # monitors
        "CD-D12-GRY",   # cables
    ]),
    ("quiet-desk", "The quiet desk",
     "Low-profile keyboards, silent mice and warm-light lamps, chosen for long working days.", [
        SPOTLIGHT_SKU,   # low-profile keyboard
        "KS-ARC-WHT",    # silent mouse
        "LM-ARC-LAMP",   # warm-light lamp
        "HD-K4-GRY",     # low-profile keyboard
        "MR-M2-WHT",     # quiet-click mouse
        "LM-BEAM-BLK",   # warm-light monitor light bar
    ]),
]

# How many images B2 curates per product: 3 for a product in the spotlight or
# featured collections, 1 for every other product.
IMAGE_COUNT = {"spotlight or featured": 3, "other": 1}

# Owner decision (2026-11-23): stock libraries have no clean side view of a light,
# logo-free, English-layout keyboard, so the spotlight keyboard keeps 2 photos
# (hero and in use) instead of 3.
IMAGE_COUNT_OVERRIDES = {SPOTLIGHT_SKU: 2}
