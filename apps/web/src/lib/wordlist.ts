/**
 * The words generated passphrases are made of: 1,035 words of 3 to 5 lowercase letters, so each word adds
 * log2(1035) ≈ 10.0 bits; 6 distinct words ≈ 60.1 bits, 7 ≈ 70.1 bits (lib/passphrase.ts).
 *
 * Source: EFF's Short Wordlist #1 (1,296 words), https://www.eff.org/files/2016/09/08/eff_short_wordlist_1.txt
 * (SHA-256 of the file as downloaded on 2026-11-15: 8f5ca830b8bffb6fe39c9736c024a00a6a6411adb3f83a9be8bfeeb6e067ae69),
 * from "EFF's New Wordlists for Random Passphrases" by Joseph Bonneau, Electronic Frontier Foundation (2016).
 * Licence: Creative Commons Attribution 4.0 International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/
 * (EFF's copyright page, https://www.eff.org/copyright). See NOTICE at the repository root.
 *
 * Changes: the dice numbers are dropped, and 261 words are removed in two engineer screens (violence, weapons and
 * crime; court words; restraint, pursuit and surveillance; sexual words and slang; body parts and bodily functions;
 * pregnancy; illness, disability and death; alcohol; drugs and how being drugged feels; medical and forensic exams;
 * distressing feelings; insults; religion and politics; marriage; words easily confused with another when spoken or
 * read; words phones autocorrect; and "yo-yo", whose hyphen is our separator). The pull request that brought this
 * list in names every removed word and why.
 *
 * NOT FINAL: an advocate who works with survivors must review this list before launch (plan §9.3 advocate gates).
 * The screens above were done by engineers, not an advocate. Changing the list changes WORDLIST_SHA256 below, on
 * purpose: passphrase.test.ts pins it, so no edit lands without someone looking at it. Keep at least 1,024 words
 * (6 distinct words must stay at or above 60 bits).
 */
export const WORDLIST: readonly string[] = `
acorn acre afar affix aged agent agile aging ahead aide aim ajar alarm alias alien alike alive aloe aloft aloha
amend amino ample amuse angel angle apple april apron aqua area arena argue arise armor aroma array art atlas atom
attic audio avert avoid awake award awoke axis bacon badge bagel baggy baker balmy banjo barge barn basil bask batch
bats blaze blend bless blimp blink bloat blob blog blot blurt blush boast boat boil bok bolt bonus book booth boots
boss botch both brick brim bring brink brisk broad broil broke brook broom brush buck bud buggy bulk bunch bunny
bunt busy buzz cable cache cadet cake calm cameo canal candy cane canon cape card cargo carol carry carve case cash
cause cedar chair chant charm cheer chef chess chew chief chili chill chomp chow chuck chunk churn chute city civic
civil clad claim clap clasp class claw clay clean clear cleat clerk click cling clink clip cloak clock clone cloth
cloud clump coach coast coat coil cola cold colt come comic comma cone cope copy coral cost cot couch cover cozy
craft crane crank crate crave crawl creme crepe crisp crop cross crowd crown crumb crush crust cub cupid cure curl
curry curve cushy cycle dad daily dairy daisy dance dandy darn dart dash data dawn deal dean debit debug decaf decal
decay decor decoy deed delay denim dense dent depth derby desk dial dice dig dill dime diner dingy disco dish disk
ditch dock dodge doing doll dome donut dot dove down drab drama draw dress dried drill drive drone droop drove drum
dry duck duct dude dug duke duo dusk dust duty dwell eagle early earth easel east eaten eats ebony ebook echo edge
eel eject elder elm elude elves email emit empty emu enter entry envoy equal erase error erupt essay etch evade even
evoke exact exit fable faced fact fade fall false fancy fang feast feed fence fend ferry fetch fever fiber fifth
fifty film final finch fit five flag flaky flame flap flick flint flip float flock flop floss flyer foam foil folk
food found fox foyer frame fray fresh fried frill from front frost froth frown froze fruit gains gala game gap gas
gave gear gecko geek gem genre gift gig gills given giver glad glass glide gloss glove glow glue goal going golf
gong good gooey goofy gown grain grant grape graph grasp grass gravy gray green greet grew grid grill grip grit
growl grub grunt guide gulf gulp gummy guru guy habit half halo halt happy hasty hatch haven hazel heap heat heave
hedge hefty help herbs hub hula hull human humid hurry hut ice icing icon icy igloo image ion iron issue item ivory
ivy jam jazz jeep jelly jet jiffy job jolly jolt joy juice juicy july jumbo jump keep kilt king kite kiwi koala kung
ladle lady lair lake land lapel large last latch late lazy left legal lemon lend lens level lever lid life lift
lilac lily limes line lint lion list lived lunar lunch lurch lyric maker mama mango manor many map march mardi mash
match mate math mocha mold mom moody mop morse most motor motto mouse mousy move movie mower mud mulch mull mumbo
mural muse music musky nacho nag nail name nanny navy near neat neon nerd nest next niece ninth oak oasis oat ocean
oil old olive omen onion only opal open opera opt otter ounce outer oval oven owl ozone pace pager palm panda pants
paper park party pasta patch path patio payer pecan penny pep perch perm pest petal petri petty photo plank plant
plaza plot plow pluck plug plus poach pod poem poet pogo point poise poker polar polka polo pond pony poppy pork
poser pouch pout power prank press print prior prism prize prong proof props prune pry pug pull pulp puma punk pupil
puppy purr purse push putt quack quake query quiet quill quilt quit quota quote race radar radio raft rail rake
rally ramp ranch range rank rant raven reach react ream rebel recap relax relay relic remix repay repel reply rerun
reset rhyme rice rich ride rigid rigor rinse ripen rise risk ritzy rival river roast robe robin rock rogue roman
rover royal ruby rug rule rush rust rut sage said saint salad salon salsa salt same sandy santa satin sauna saved
savor sax say scale scan scarf scoff scoop scoot scope score scout scowl scrap scrub scuba scuff sedan self send
sepia serve set seven shack shade shady sham shape share sharp shed sheep sheet shelf shell shine shiny ship shirt
shop shore shout shown showy shred shrug shut shy sift silk silly silo siren sixth size skate skew skid skier skies
skip skirt skit sky slab slack slang slate slaw sled sleek sleep sleet slice slick slimy sling slip slot slurp slush
small smell smile smirk smog snack snap snarl sniff snout snowy snub speak spend spill spiny spoil spoke spoof spool
spoon sport spot spout spray spur squad squat squid stack staff stage stall stamp stand stank stark start state
stays steam steep stem step stew stick sting stir stock stony stood stool stoop stop storm stout stove straw stray
strut stuck stuff stump stung stunt suds sugar sulk surf sushi swan swarm sway sweep swell swim swing swipe swirl
swoop swore syrup tacky taco tag take tall talon tamer tank taper taps tarot task taste tasty thank thaw theme thing
think thorn those thus tiara tidal tidy tiger tile tilt tint tiny trace track trade train trait trash tray treat
tree trek trend tribe trio trout truce truck trunk try tug tulip turf tusk tutor tutu tux tweak tweet twice twine
twins twirl twist uncle uncut undo unify union unit upon upper urban used user usher utter value vapor vegan venue
verse vest veto vice video view viral virus visa visor vocal voice void volt voter vowel wafer wager wages wagon
wake walk wand wasp watch water wavy wheat whiff whole whoop wick widen width wilt wind wing wipe wired wiry wise
wish wispy wolf wool word work woven yahoo yard year yeast yelp yield yodel yoga yoyo yummy zebra zero zesty zippy
zone zoom
`
  .split(/\s+/)
  .filter(Boolean);

/** SHA-256 of the list joined with single spaces (see above: an edit must update this, and needs advocate review). */
export const WORDLIST_SHA256 = '7745530d159952e82b5b5f4ac7a012ab6fbbbc1ebb7ecf5248525d523503272a';
