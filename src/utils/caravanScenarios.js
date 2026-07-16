// utils/caravanScenarios.js

export const caravanScenarios = [
    {
        id: "bandit_ambush",
        category: 1, // Raiders & Rebels
        title: "The Blade of the Dunes",
        description: "A band of desert outlaws blocks the narrow mountain pass! Their leader demands a tax to pass safely, or they promise to tear your carriage apart.",
        optionALabel: "Pay Bribe (Costs 300 Dirhams)",
        optionBLabel: "Outrun Them (Risk Cargo)",
        optionAEffect: { goldChange: -300, integrityChange: 0, text: "You reluctantly slide a purse of 300 Dirhams to the bandit chief. He smiles and lets your caravan pass without a scratch." },
        optionBEffect: { goldChange: 0, integrityChange: -30, text: "You whip the camels into a frenzy! You crash through their barricade under a hail of arrows. You escape, but the carriage took heavy damage (-30% Cargo Integrity)." }
    },
    {
        id: "sandstorm",
        category: 2, // Desert Fury
        title: "The Choking Dust",
        description: "A colossal red wall of sand appears on the horizon, a fierce desert sandstorm. You can push forward blindly or pay to hunker down securely at a nearby encampment.",
        optionALabel: "Pay for Shelter (Costs 150 Dirhams)",
        optionBLabel: "Braving the Storm (Risk Cargo)",
        optionAEffect: { goldChange: -150, integrityChange: 0, text: "You pay local nomads 150 Dirhams for heavy tents and camel shelter. You wait out the storm safely with zero damage." },
        optionBEffect: { goldChange: 0, integrityChange: -25, text: "You push through. The biting winds rip your protective tarps open, scattering fine goods into the dunes (-25% Cargo Integrity)." }
    },
    {
        id: "palmyra_toll",
        category: 3, // The Wali’s Toll
        title: "The Wali's Inspector",
        description: "At the Palmyra border gate, a pompous tax inspector demands a hefty tariff on your luxury cargo. You can pay the official legal fee or try to quietly slide him a bribe.",
        optionALabel: "Pay Legal Fee (Costs 250 Dirhams)",
        optionBLabel: "Slide a Bribe (Costs 100 Dirhams)",
        optionAEffect: { goldChange: -250, integrityChange: 0, text: "You pay the official 250 Dirhams tariff. The inspector stamps your ledger with a sigh, and you proceed legally." },
        optionBEffect: { goldChange: -100, integrityChange: -15, text: "You slide him 100 Dirhams under your travel permit. He pockets it, but forces his guards to search your cart to keep up appearances, damaging fragile packaging (-15% Cargo Integrity)." }
    },
    {
        id: "broken_wheel",
        category: 6, // Herd & Harness
        title: "The Shattered Axle",
        description: "A loud crack echoes through the canyon as one of your heavy transport wheels shatters on a jagged rock. You can buy wood from a passing nomad, or abandon the damaged cart's contents.",
        optionALabel: "Buy Wood (Costs 150 Dirhams)",
        optionBLabel: "Abandon Cart (Risk Cargo)",
        optionAEffect: { goldChange: -150, integrityChange: 0, text: "You purchase spare timber for 150 Dirhams. Your crew repairs the axle in under an hour, saving your entire inventory." },
        optionBEffect: { goldChange: 0, integrityChange: -20, text: "You burn the broken cart and leave some heavy cargo behind in the sand to lighten the load (-20% Cargo Integrity)." }
    },
    {
        id: "hidden_pass",
        category: 7, // The Hidden Track
        title: "The Nomad's Shortcut",
        description: "A rugged guide points to a treacherous gorge shortcut. It bypasses days of travel and could double your sales, but the terrain is incredibly punishing.",
        optionALabel: "Take Shortcut (High Risk)",
        optionBLabel: "Stay on Main Road (Safe)",
        optionAEffect: { goldChange: 500, integrityChange: -25, text: "The gorge is brutal on the camels, but you arrive ahead of schedule and sell fresh water at an extreme premium (+500 Dirhams, but -25% Cargo Integrity from the rocky path)." },
        optionBEffect: { goldChange: 0, integrityChange: 0, text: "You stick to the safe, dusty main road. It is long and boring, but you take absolutely zero damage." }
    },
    {
        id: "viper_bite",
        category: 8, // The Hakim’s Aid
        title: "The Serpent's Tooth",
        description: "During an overnight camp, a venomous black cobra bites your lead caravan navigator. You can buy rare antivenom from a traveling physician, or use cheap but ineffective mud poultices.",
        optionALabel: "Buy Antivenom (Costs 200 Dirhams)",
        optionBLabel: "Use Clay Poultice (Free)",
        optionAEffect: { goldChange: -200, integrityChange: 0, text: "You purchase the rare antivenom for 200 Dirhams. Within hours, your navigator is back on their feet and keeping the caravan perfectly on track." },
        optionBEffect: { goldChange: 0, integrityChange: -25, text: "The crude poultice fails. The feverish navigator leads the caravan off-route into a rocky ditch, bruising your pack animals (-25% Cargo Integrity)." }
    },
    {
        id: "stranded_trader",
        category: 9, // Rival Merchants
        title: "The Broken Competitor",
        description: "You find a rival trader stranded on the salt flats with a collapsed mule. They beg you for water and offer a crate of exotic saffron in return if you help tow them.",
        optionALabel: "Tow Them (Costs 100 Dirhams Supplies)",
        optionBLabel: "Ignore Them (No Cost)",
        optionAEffect: { goldChange: 400, integrityChange: 0, text: "You share your rations and hitch their cart to your camels. Upon reaching the market, you sell their gifted saffron for a massive profit (+400 Net Dirhams gain)." },
        optionBEffect: { goldChange: 0, integrityChange: 0, text: "You ride past them silently. It is a harsh world, and you must protect your own resources. You reach the next oasis safely." }
    }
];

export function getRandomCaravanScenario(excludeIds = []) {
    const available = caravanScenarios.filter(s => !excludeIds.includes(s.id));
    if (available.length === 0) return caravanScenarios[Math.floor(Math.random() * caravanScenarios.length)];
    return available[Math.floor(Math.random() * available.length)];
}
