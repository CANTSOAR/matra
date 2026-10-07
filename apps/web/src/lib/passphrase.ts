/**
 * Passphrase suggestions. A small embedded list of plain, calm, easy-to-type words
 * (no violent or distressing words). 5 words from ~330 ≈ 42 bits of entropy, which —
 * on top of 600k PBKDF2 iterations — is a reasonable floor for this threat model.
 */
export const WORDLIST: readonly string[] = `
acorn adobe alpine amber anchor apple apricot arbor arctic atlas autumn avocado
bakery balcony bamboo banjo barley basil basket beacon beetle berry birch biscuit
blanket blossom bluebird bonnet bramble breeze brick bridge brook bubble bucket
buffalo butter button cabin cactus calico camel candle canoe canyon caramel cargo
carrot cashew castle cedar celery cello chalk channel cherry chestnut chimney
cider cinnamon citrus clover cobalt coconut comet compass copper coral cotton
cocoa cozy crayon cricket crystal cupcake curtain cypress daisy dawn delta denim
desert dolphin domino dove dragonfly drizzle dune easel echo eclipse elbow
elm ember emerald engine falcon fable fennel fern ferry fiddle fig finch fjord
flannel flute foggy forest fossil fountain fox freckle frost galaxy garden garnet
gazebo gecko geyser ginger glacier globe gondola gopher granite grape gravel
grove guitar gumdrop hammock harbor harvest hazel heron hickory hilltop honey
horizon hummus iceberg igloo indigo island ivory jacket jasmine jelly jigsaw
juniper kayak kettle kiwi koala lagoon lantern lark lattice lavender lemon lentil
lilac linen lobster locket lotus lunar lychee magnet mango maple marble marigold
meadow melon mint mitten mocha monsoon moose mosaic moss muffin mural nectar
needle nest noodle nutmeg oasis oatmeal ocean olive onyx opal orbit orchard
orchid otter owl oyster paddle pagoda pancake panda paper parade parsley pastel
peach peacock pebble pecan pelican pepper piano pickle pigeon pillow pine
pinwheel pistachio planet plum pocket polka pony popcorn poppy porch prairie
pretzel prism puffin pumpkin quail quartz quill quilt rabbit radish rainbow
raisin raven reef ribbon ripple river robin rocket rosemary ruby saddle saffron
sage sailboat salmon sandal sapphire satchel scarf seashell sequoia sesame shadow
shore sierra silver sketch sled snowflake sonnet sparrow spinach spruce squash
starfish summit sunbeam sunflower sushi swan sweater tadpole tangerine teacup
teapot thimble thistle thunder tiger timber toast tofu topaz tortoise toucan
tulip tundra turnip tuxedo twig ukulele umbrella valley vanilla velvet violet
violin voyage waffle walnut walrus wagon wander wasabi water wave whisker willow
window winter wisteria wombat woodland yarrow yogurt zebra zephyr zinnia zucchini
`
  .split(/\s+/)
  .filter(Boolean);

function randomIndex(n: number): number {
  // rejection sampling to avoid modulo bias
  const max = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < max) return buf[0] % n;
  }
}

export function generatePassphrase(words = 5, list: readonly string[] = WORDLIST): string {
  const out: string[] = [];
  for (let i = 0; i < words; i++) out.push(list[randomIndex(list.length)]);
  return out.join('-');
}

export type Strength = 'too-short' | 'weak' | 'okay' | 'strong';

/** Rough, conservative strength estimate used only for UX guidance. */
export function passphraseStrength(p: string): { level: Strength; message: string } {
  const s = p.trim();
  if (s.length < 12) return { level: 'too-short', message: 'Use at least 12 characters — a few random words works well.' };
  const words = s.split(/[\s\-_.,]+/).filter((w) => w.length >= 3);
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(s)).length;
  if (words.length >= 5 || s.length >= 28) return { level: 'strong', message: 'Strong. Write it down somewhere only you can reach.' };
  if (words.length >= 4 || (s.length >= 16 && classes >= 3)) return { level: 'okay', message: 'Okay. Adding another random word makes it much stronger.' };
  return { level: 'weak', message: 'Weak. Try 5 random words — like the suggestion below.' };
}
