"""Seed content for the 55 products: price, cost, tagline, description and specs.

Keyed by sku. Product identity (names, brands, slugs) lives in catalogue_data.
Every brand is invented. Each category uses its own spec labels, in this order:

  keyboards  Layout, Connection, Switches, Battery, Weight
  mice       Sensor, Connection, Buttons, Battery, Weight
  monitors   Size, Resolution, Panel, Ports, Stand
  audio      Type, Connection, Battery, Microphone, Weight
  desk       Dimensions, Material, Power, Weight
  cables     Length, Ports, Power delivery, Data rate

Money is a string of pounds and pence, tax-inclusive, as the schema stores it.
"""

from decimal import ROUND_HALF_UP, Decimal

from scripts.catalogue_data import PRODUCTS

LABELS: dict[str, tuple[str, ...]] = {
    "keyboards": ("Layout", "Connection", "Switches", "Battery", "Weight"),
    "mice": ("Sensor", "Connection", "Buttons", "Battery", "Weight"),
    "monitors": ("Size", "Resolution", "Panel", "Ports", "Stand"),
    "audio": ("Type", "Connection", "Battery", "Microphone", "Weight"),
    "desk": ("Dimensions", "Material", "Power", "Weight"),
    "cables": ("Length", "Ports", "Power delivery", "Data rate"),
}

# Share of the price the shop pays for the product, per category.
COST_RATIO = {"keyboards": "0.58", "mice": "0.55", "monitors": "0.72", "audio": "0.57",
              "desk": "0.52", "cables": "0.45"}

_RAW: dict[str, tuple[str, str, str, tuple[str | None, ...]]] = {
    # --- keyboards: Layout, Connection, Switches, Battery, Weight ---
    "HD-QUILL-GRY": ("119.00", "Quiet keys. Three devices. One cable.",
        ("A slim wireless keyboard with soft, quiet keys. Pair it with three devices, "
        "switch with one key press, and charge it over USB-C."),
        ("UK ISO, 75%", "Bluetooth 5.2 or USB-C", "Low-profile, silent", "Up to 6 months", "612 g")),
    "HD-K4-GRY": ("79.00", "Full size, low profile.",
        ("A full-size keyboard with a number pad and a flat, even typing feel. "
        "Built for people who type all day."),
        ("UK ISO, full size", "Bluetooth 5.0 or USB receiver", "Low-profile scissor",
         "Up to 4 months", "745 g")),
    "HD-S1-BLK": ("149.00", "Two halves. Less strain.",
        ("A split keyboard with a gentle tent angle and a padded palm rest. "
        "It keeps your wrists straight over a long day."),
        ("UK ISO, split", "USB-C", "Low-profile tactile", None, "980 g")),
    "MR-SLIM2-WHT": ("64.00", "Thin, light and quick to pair.",
        ("A thin wireless keyboard that slips into a bag. Quiet keys, a clean white finish "
        "and a battery that lasts months."),
        ("UK ISO, compact", "Bluetooth 5.0", "Low-profile scissor", "Up to 3 months", "430 g")),
    "MR-QT87-BLK": ("99.00", "Mechanical feel, without the noise.",
        ("A tenkeyless keyboard with dampened switches and foam-lined keys. "
        "It sounds like a whisper and feels like a proper keyboard."),
        ("UK ISO, 87 keys", "USB-C", "Silent linear", None, "820 g")),
    "MR-NP1-WHT": ("29.00", "A number pad for any desk.",
        ("A slim wireless number pad for spreadsheets and tills. "
        "It pairs in seconds and sits neatly beside any keyboard."),
        ("22 keys", "Bluetooth 5.0", "Low-profile scissor", "Up to 6 months", "170 g")),
    "TS-T75-GRY": ("129.00", "Compact, hot-swappable, properly satisfying.",
        ("A 75% mechanical keyboard in a solid aluminium case. Switches can be swapped "
        "without tools, and the gasket mount gives it a soft, rounded sound."),
        ("UK ISO, 75%", "Bluetooth 5.1, USB-C", "Hot-swap tactile", "Up to 2 months",
         "1.1 kg")),
    "TS-T100-BLK": ("139.00", "Every key. A very solid board.",
        ("A full-size mechanical keyboard with a metal plate and a thick, heavy case. "
        "It does not slide about, and it does not rattle."),
        ("UK ISO, full size", "USB-C", "Hot-swap linear", None, "1.4 kg")),
    "TS-FOLD-BLK": ("49.00", "Folds flat. Types like a full one.",
        ("A folding Bluetooth keyboard that fits in a jacket pocket. "
        "Open it up and it is a full three-row layout for tablets and phones."),
        ("UK ISO, folding", "Bluetooth 5.0", "Low-profile scissor", "Up to 2 months", "240 g")),

    # --- mice: Sensor, Connection, Buttons, Battery, Weight ---
    "KS-ARC-WHT": ("39.00", "Click without the click.",
        ("A silent wireless mouse for open offices and late evenings. "
        "The buttons are quiet and the scroll wheel is smooth."),
        ("Optical, 1600 DPI", "USB receiver or Bluetooth", "5", "1 AA, up to 18 months",
         "82 g")),
    "KS-V3-GRY": ("69.00", "Handshake grip, relaxed wrist.",
        ("A vertical mouse that holds your forearm in a natural position. "
        "Most people feel the difference within a week."),
        ("Optical, 1800 DPI", "USB receiver or Bluetooth", "6", "Rechargeable, up to 3 months",
         "110 g")),
    "KS-P5-BLK": ("89.00", "Precise, quick and quietly clever.",
        ("A wireless mouse with a fast sensor and a scroll wheel that spins free or clicks "
        "from notch to notch. Good for design work and long documents."),
        ("Optical, 4000 DPI", "USB receiver or Bluetooth", "7", "Rechargeable, up to 70 days",
         "99 g")),
    "KS-TB2-GRY": ("79.00", "Move the ball, not your arm.",
        ("A wireless trackball you can use in a small space. "
        "The ball sits under your thumb, and the mouse never has to move."),
        ("Optical, 2000 DPI", "USB receiver or Bluetooth", "5", "Rechargeable, up to 2 months",
         "145 g")),
    "KS-GLIDE-BLU": ("24.00", "Small enough for any bag.",
        ("A compact wireless mouse with a soft-touch finish. "
        "It travels well and works on most surfaces."),
        ("Optical, 1200 DPI", "Bluetooth 5.0", "3", "1 AAA, up to 12 months", "58 g")),
    "MR-M2-WHT": ("29.00", "A soft click, a steady hand.",
        "A quiet-click mouse for everyday work. Light in the hand, easy on the ears.",
        ("Optical, 1200 DPI", "USB receiver", "3", "1 AA, up to 15 months", "74 g")),
    "MR-W1-BLK": ("12.00", "Plug in and get on with it.",
        ("A wired office mouse with a 1.5 m cable. No batteries, no pairing, "
        "nothing to go wrong."),
        ("Optical, 1000 DPI", "USB-A cable", "3", None, "86 g")),
    "MR-L1-BLK": ("59.00", "Made for the left hand.",
        ("An ergonomic mouse shaped for left-handed use. "
        "The thumb rest and curved body take the strain off your wrist."),
        ("Optical, 1600 DPI", "USB receiver or Bluetooth", "6", "Rechargeable, up to 2 months",
         "102 g")),
    "MR-PAD1-GRY": ("109.00", "A glass trackpad for the desk.",
        ("A large wireless trackpad with a smooth glass surface and multi-finger gestures. "
        "It brings laptop-style control to your desktop."),
        ("Multi-touch", "Bluetooth 5.0, USB-C", "Press anywhere", "Rechargeable, up to 1 month",
         "230 g")),

    # --- monitors: Size, Resolution, Panel, Ports, Stand ---
    "AS-F24-BLK": ("129.00", "A clean, bright everyday screen.",
        ("A 24-inch Full HD monitor with thin edges and a matt finish. "
        "A dependable second screen or a first one."),
        ("24 inch", "1920 x 1080", "IPS, 75 Hz", "HDMI, DisplayPort", "Tilt")),
    "AS-Q27-BLK": ("229.00", "More room to work.",
        ("A 27-inch QHD monitor with sharp text and accurate colour. "
        "The extra pixels fit two documents side by side."),
        ("27 inch", "2560 x 1440", "IPS, 75 Hz", "HDMI, DisplayPort, USB-A hub",
         "Tilt, height, swivel")),
    "AS-U27-SLV": ("349.00", "4K. One USB-C cable.",
        ("A 27-inch 4K monitor that charges your laptop and shows the picture over one USB-C "
        "cable. It also gives you a USB hub for your keyboard and mouse."),
        ("27 inch", "3840 x 2160", "IPS, 60 Hz", "USB-C 65 W, HDMI, DisplayPort, USB-A hub",
         "Tilt, height, swivel, pivot")),
    "AS-U32-SLV": ("499.00", "A big, calm 4K canvas.",
        ("A 32-inch 4K monitor for spreadsheets, code and photo work. "
        "Wide viewing angles and an even backlight."),
        ("32 inch", "3840 x 2160", "VA, 60 Hz", "HDMI x2, DisplayPort, USB-C 90 W",
         "Tilt, height")),
    "AS-W34-BLK": ("429.00", "Wide enough for a week of tabs.",
        ("A 34-inch curved ultrawide monitor. Two full-size windows fit side by side, "
        "with no bezel down the middle."),
        ("34 inch curved", "3440 x 1440", "VA, 100 Hz", "HDMI x2, DisplayPort, USB-C 65 W",
         "Tilt, height")),
    "AS-P16-GRY": ("199.00", "A second screen that fits in a bag.",
        ("A slim portable monitor with a fold-out cover. One USB-C cable powers it "
        "and carries the picture."),
        ("16 inch", "1920 x 1200", "IPS, 60 Hz", "USB-C x2, mini HDMI", "Folding cover")),
    "TS-ARM1-BLK": ("49.00", "Lift the screen. Free the desk.",
        ("A single monitor arm with a smooth gas spring. Clamps to the desk edge "
        "and holds screens up to 9 kg."),
        ("Up to 32 inch", "VESA 75 x 75, 100 x 100", "Steel and aluminium", "Cable channel",
         "Desk clamp")),
    "TS-ARM2-BLK": ("89.00", "Two screens, one clamp.",
        ("A dual monitor arm for two screens up to 8 kg each. "
        "Each screen moves on its own, and the cables run through the arm."),
        ("Up to 27 inch each", "VESA 75 x 75, 100 x 100", "Steel and aluminium",
         "Cable channel", "Desk clamp")),
    "TS-ARMHD-BLK": ("119.00", "For the heaviest screens.",
        ("A heavy-duty monitor arm for large and ultrawide screens up to 15 kg. "
        "It stays where you put it."),
        ("Up to 49 inch", "VESA 100 x 100, 200 x 100", "Steel", "Cable channel",
         "Desk clamp or grommet")),

    # --- audio: Type, Connection, Battery, Microphone, Weight ---
    "OR-H1-BLK": ("149.00", "Clear calls, all day.",
        ("A wireless headset with a boom microphone that filters out the room. "
        "Light on the head, with a battery that lasts a full working week."),
        ("Over-ear headset", "Bluetooth 5.2, USB dongle", "Up to 40 hours",
         "Boom, noise-cancelling", "260 g")),
    "OR-H3-BLK": ("249.00", "Switch the world off.",
        ("Wireless noise-cancelling headphones with soft ear cushions. "
        "Good for focus, flights and open-plan offices."),
        ("Over-ear headphones", "Bluetooth 5.3, 3.5 mm cable", "Up to 35 hours",
         "Built-in, for calls", "285 g")),
    "OR-E2-WHT": ("89.00", "Small, comfortable, well balanced.",
        ("True wireless earbuds with a pocket-sized case. They fit securely "
        "and sound natural for calls and music."),
        ("In-ear earbuds", "Bluetooth 5.3", "6 hours, 24 with case", "Dual microphone",
         "48 g with case")),
    "OR-S2-GRY": ("59.00", "Full sound for a small desk.",
        ("A pair of compact desktop speakers with a clear, warm sound. "
        "Plug in over USB or 3.5 mm and use the dial on the front."),
        ("2.0 speakers", "USB-C, 3.5 mm", None, None, "1.4 kg")),
    "OR-C1-BLK": ("129.00", "Everyone in the room, heard.",
        ("A USB speakerphone for meeting rooms and small teams. "
        "Four microphones pick up voices from around the table."),
        ("Speakerphone", "USB-C, Bluetooth 5.0", "Up to 12 hours", "4 microphones, 360 degrees",
         "420 g")),
    "MR-H2-BLK": ("49.00", "A good headset without the fuss.",
        ("A stereo USB headset with a flexible microphone and in-line controls. "
        "It works with most laptops and softphones."),
        ("Over-ear headset", "USB-A cable", None, "Boom, noise-reducing", "168 g")),
    "MR-H2M-BLK": ("39.00", "One ear on the call, one on the room.",
        ("A mono USB headset for people who need to hear the office around them. "
        "Comfortable, light and simple."),
        ("On-ear headset", "USB-A cable", None, "Boom, noise-reducing", "92 g")),
    "MR-MIC1-BLK": ("79.00", "Sound like you are in the room.",
        ("A USB condenser microphone with a solid stand and a mute button. "
        "Plug it in and it is ready for calls and recordings."),
        ("Desktop microphone", "USB-C", None, "Cardioid condenser", "540 g")),
    "MR-BAR1-BLK": ("45.00", "A slim bar for under the screen.",
        ("A compact soundbar that sits under your monitor. "
        "Clearer than built-in speakers, and it takes up no desk space."),
        ("Monitor soundbar", "USB-A, 3.5 mm", None, None, "380 g")),
    "MR-BUD1-BLK": ("14.00", "Simple wired calls.",
        ("A wired headset with a clip-on microphone. Discontinued, "
        "replaced by the H2 USB Office Headset."),
        ("In-ear headset", "3.5 mm cable", None, "In-line", "24 g")),

    # --- desk: Dimensions, Material, Power, Weight ---
    "LM-ARC-LAMP": ("45.00", "Warm light, no glare.",
        ("An LED desk lamp with a long arm and three colour temperatures. "
        "The light is soft and even, and it is easy on the eyes."),
        ("Reach 60 cm, base 16 cm", "Aluminium and ABS", "USB-C, 8 W", "780 g")),
    "LM-BEAM-BLK": ("59.00", "Light for the desk, not the screen.",
        ("A light bar that clips on top of your monitor. "
        "It lights the desk without a reflection in the glass."),
        ("45 cm wide", "Aluminium", "USB-A, 5 W", "310 g")),
    "LM-C1-BLK": ("69.00", "Look as good as you sound.",
        ("A 1080p webcam with a wide lens, a privacy shutter and a built-in microphone. "
        "It sits on a monitor or a tripod."),
        ("90 x 30 x 30 mm", "ABS and glass", "USB-A cable", "130 g")),
    "HD-FELT-GRY": ("29.00", "Soft under the hands.",
        ("A large felt desk mat. It quietens the keyboard, protects the desk "
        "and gives the mouse a smooth surface."),
        ("90 x 40 cm", "Wool felt, 3 mm", None, "640 g")),
    "HD-LTHR-BRN": ("69.00", "A desk mat that gets better with use.",
        ("A leather desk mat with a stitched edge and a non-slip base. "
        "It wipes clean and ages well."),
        ("80 x 40 cm", "Vegetable-tanned leather", None, "880 g")),
    "HD-REST-GRY": ("19.00", "A soft place for your wrists.",
        ("A memory-foam wrist rest with a washable cover. "
        "It keeps your wrists flat for typing."),
        ("44 x 9 cm", "Memory foam, fabric cover", None, "170 g")),
    "TS-LS1-SLV": ("49.00", "Raise the laptop. Lift your posture.",
        ("A solid aluminium stand that brings your laptop to eye level. "
        "It folds flat for travel."),
        ("26 x 22 cm, 6 heights", "Anodised aluminium", None, "520 g")),
    "TS-VS1-SLV": ("35.00", "Close the lid, free the desk.",
        ("A vertical stand that holds a closed laptop upright. "
        "Handy with an external monitor and keyboard."),
        ("22 x 10 cm", "Anodised aluminium", None, "640 g")),
    "TS-DR1-BLK": ("189.00", "Sit or stand, with one hand.",
        ("A desk converter that lifts your screen and keyboard to standing height. "
        "The gas spring does the work, and it holds up to 15 kg."),
        ("80 x 40 cm, lifts 41 cm", "Steel and laminated board", None, "14.5 kg")),

    # --- cables: Length, Ports, Power delivery, Data rate ---
    "CD-D12-GRY": ("229.00", "One cable. Your whole desk.",
        ("A USB-C docking station with dual display output, Ethernet and a card reader. "
        "Plug in once and everything is connected."),
        ("1.0 m host cable", "2 x HDMI, DisplayPort, 4 x USB-A, 2 x USB-C, Ethernet, SD",
         "Up to 96 W", "10 Gbps")),
    "CD-H7-GRY": ("39.00", "Seven ports, one plug.",
        ("A powered USB hub with seven ports and individual switches. "
        "It is built to keep every drive and dongle running."),
        ("1.0 m host cable", "7 x USB-A", "Up to 7.5 W per port", "5 Gbps")),
    "CD-C2-BLK": ("14.00", "A sturdy USB-C cable.",
        ("A braided USB-C cable that charges laptops and moves files. "
        "Two metres is long enough to reach the wall."),
        ("2 m", "USB-C to USB-C", "Up to 100 W", "480 Mbps")),
    "CD-HD2-BLK": ("19.00", "Sharp picture, high refresh rate.",
        "An HDMI 2.1 cable for 4K at 120 Hz. It is shielded, braided and gold-plated at both ends.",
        ("2 m", "HDMI to HDMI", None, "48 Gbps")),
    "CD-DP2-BLK": ("17.00", "A clean link to your monitor.",
        ("A DisplayPort cable with latching connectors for secure fit. "
        "It runs high refresh rates and high resolutions."),
        ("2 m", "DisplayPort to DisplayPort", None, "32.4 Gbps")),
    "MR-T4-GRY": ("49.00", "A hub that goes where you go.",
        ("A slim USB-C hub with HDMI, two USB-A ports and a card reader. "
        "It passes power through to your laptop."),
        ("15 cm built-in cable", "HDMI, 2 x USB-A, SD, USB-C", "Up to 100 W pass-through",
         "5 Gbps")),
    "MR-P65-WHT": ("45.00", "Laptop power, pocket size.",
        "A 65 W USB-C charger with a foldable plug. It charges a laptop and a phone at once.",
        ("Plug only", "2 x USB-C", "65 W total", None)),
    "MR-E1-GRY": ("24.00", "A wired network, anywhere.",
        ("A USB-C adapter with a Gigabit Ethernet port. "
        "Use it when Wi-Fi is slow or unavailable."),
        ("12 cm built-in cable", "USB-C to RJ45", None, "1 Gbps")),
    "MR-A1-WHT": ("9.00", "Old plugs, new ports.",
        ("A tiny adapter that turns a USB-C port into a USB-A one. "
        "Handy for memory sticks and older gear."),
        ("3 cm", "USB-C to USB-A", None, "5 Gbps")),
}


def _build() -> dict[str, dict]:
    category = {sku: cat for sku, _slug, _name, _brand, cat in PRODUCTS}
    content: dict[str, dict] = {}
    for sku, (price, tagline, description, values) in _RAW.items():
        cat = category[sku]
        price_d = Decimal(price)
        cost = (price_d * Decimal(COST_RATIO[cat])).quantize(Decimal("0.01"), ROUND_HALF_UP)
        content[sku] = {
            "price": price,
            "unit_cost": str(cost),
            "tagline": tagline,
            "description": description,
            "specs": [{"label": label, "value": value}
                      for label, value in zip(LABELS[cat], values, strict=True)
                      if value is not None],
        }
    return content


CONTENT: dict[str, dict] = _build()
