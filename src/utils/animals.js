export const ANIMALS = {
    // === COMMON (45% Total Catch Rate) ===
    mouse: { id: 'mouse', name: 'Field Mouse', emoji: '🐭', chance: 10, minPrice: 5, maxPrice: 12 },
    rabbit: { id: 'rabbit', name: 'Rabbit', emoji: '🐇', chance: 10, minPrice: 10, maxPrice: 20 },
    duck: { id: 'duck', name: 'Duck', emoji: '🦆', chance: 10, minPrice: 15, maxPrice: 35 },
    chicken: { id: 'chicken', name: 'Chicken', emoji: '🐔', chance: 10, minPrice: 8, maxPrice: 18 },
    pigeon: { id: 'pigeon', name: 'Pigeon', emoji: '🐦', chance: 5, minPrice: 12, maxPrice: 25 },

    // === UNCOMMON (30% Total Catch Rate) ===
    raccoon: { id: 'raccoon', name: 'Raccoon', emoji: '🦝', chance: 8, minPrice: 40, maxPrice: 70 },
    deer: { id: 'deer', name: 'Deer', emoji: '🦌', chance: 7, minPrice: 50, maxPrice: 90 },
    fox: { id: 'fox', name: 'Red Fox', emoji: '🦊', chance: 6, minPrice: 65, maxPrice: 110 },
    skunk: { id: 'skunk', name: 'Skunk', emoji: '🦨', chance: 5, minPrice: 35, maxPrice: 60 },
    owl: { id: 'owl', name: 'Barn Owl', emoji: '🦉', chance: 4, minPrice: 55, maxPrice: 95 },

    // === RARE (17% Total Catch Rate) ===
    boar: { id: 'boar', name: 'Wild Boar', emoji: '🐗', chance: 5, minPrice: 120, maxPrice: 210 },
    wolf: { id: 'wolf', name: 'Timber Wolf', emoji: '🐺', chance: 4, minPrice: 180, maxPrice: 290 },
    eagle: { id: 'eagle', name: 'Bald Eagle', emoji: '🦅', chance: 3, minPrice: 240, maxPrice: 380 },
    snake: { id: 'snake', name: 'Cobra', emoji: '🐍', chance: 3, minPrice: 150, maxPrice: 260 },
    badger: { id: 'badger', name: 'Honey Badger', emoji: '🦡', chance: 2, minPrice: 200, maxPrice: 320 },

    // === EPIC (7% Total Catch Rate) ===
    bear: { id: 'bear', name: 'Grizzly Bear', emoji: '🐻', chance: 3, minPrice: 450, maxPrice: 750 },
    tiger: { id: 'tiger', name: 'Bengal Tiger', emoji: '🐅', chance: 2, minPrice: 800, maxPrice: 1300 },
    lion: { id: 'lion', name: 'Mountain Lion', emoji: '🦁', chance: 1, minPrice: 1100, maxPrice: 1700 },
    gorilla: { id: 'gorilla', name: 'Silverback Gorilla', emoji: '🦍', chance: 0.6, minPrice: 1300, maxPrice: 2000 },
    rhino: { id: 'rhino', name: 'Rhino', emoji: '🦏', chance: 0.4, minPrice: 1500, maxPrice: 2400 },

    // === LEGENDARY (1% Total Catch Rate) ===
    dragon: { id: 'dragon', name: 'Mythical Dragon', emoji: '🐲', chance: 0.5, minPrice: 5000, maxPrice: 9500 },
    unicorn: { id: 'unicorn', name: 'Starlight Unicorn', emoji: '🦄', chance: 0.3, minPrice: 6500, maxPrice: 11000 },
    phoenix: { id: 'phoenix', name: 'Solar Phoenix', emoji: '🦚', chance: 0.1, minPrice: 15000, maxPrice: 25000 },
    kraken: { id: 'kraken', name: 'Kraken', emoji: '🦑', chance: 0.08, minPrice: 18000, maxPrice: 30000 },
    griffin: { id: 'griffin', name: 'Griffin', emoji: '🦅', chance: 0.02, minPrice: 22000, maxPrice: 35000 }
};

export const ANIMAL_LIST = Object.values(ANIMALS);
