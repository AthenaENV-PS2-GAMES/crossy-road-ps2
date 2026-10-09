// All values are reconstruction choices, not recovered original parameters.
// Estimates from the reference video are marked as such.
export const tuning = {
    seed: 20261009,
    camera: {
        fovYDegrees: 20,
        elevationDegrees: 52,
        azimuthDegrees: 21,
        distance: 30,
        targetOffset: [0, 0, -2.5],
        followRateZ: 7,
        followRateX: 4,
        maxTargetX: 2,
        near: 5,
        far: 80,
    },
    player: {
        start: [0, 0],
        minX: -4, maxX: 4,
        hopSeconds: .15, // Video: rapid hops every ~6 frames at 30 fps (<= 0.2 s).
        hopHeight: .32,
        squash: .78,
        bumpSeconds: .10,
        yaw: {up: 0, down: Math.PI, left: Math.PI / 2, right: -Math.PI / 2},
    },
    ground: {grassY: .065, roadY: .01, railY: .07, waterY: -.12, logTop: .10, lilyTop: -.07},
    rows: {
        slots: 36, // Recycled window of rows: reaches multi.maxGap + a split view behind the leader.
        ahead: 16, // Rows generated in front of the best row.
        startSafe: 2, // Rows -1..-startSafe in front of the start are grass.
        decorX: 5, // Trees fill columns minX-decorX..maxX+decorX on grass rows (view is about +-9.5).
        playableTree: [.10, .22], // Obstacle chance per playable cell, easy..hard.
        decorTree: .62,
        tallChance: .25, rockChance: .25,
        // Segment weights at difficulty 0 and 1: grass, road, water, rail.
        weights0: [.34, .38, .18, .10],
        weights1: [.22, .44, .20, .14],
        maxLength: [[1, 2], [1, 4], [1, 3], [1, 2]], // [min, max] rows per segment.
        difficultyRows: 150, // Difficulty reaches 1 at this many rows.
        prepareRows: 2, // Next run's rows generated per frame during the death screen.
        coinChance: .12, // One coin on this share of grass/road rows (reference shows a few per screen).
    },
    traffic: {
        // Video estimate: about 3 cells/s near the player; faster lanes later.
        carSpeed: [1.6, 3.6], truckSpeed: [1.3, 2.6], speedBonus: .6, // x(1+bonus*difficulty)
        truckChance: .3,
        perLane: [2, 4],
        wrapHalfWidth: 12, // Movers re-enter beyond the visible columns.
        carHalfLength: .91, truckHalfLength: 1.45, halfDepth: .38,
        playerHalfWidth: .22, playerHalfDepth: .22,
    },
    river: {
        logSpeed: [1.0, 2.2],
        logLengths: [2, 3, 4],
        gap: [1.2, 3.6], // Free water between logs, in cells.
        carryLimitX: 5.2, // Swept beyond this |x| while riding: death.
        lilyChance: .3, lilyPads: [3, 5], // Still-water rows with pads instead of logs.
    },
    rail: {
        trainSpeed: 24, // cells/s, much faster than road traffic (video: crosses in well under 1 s).
        wagons: 4, carLength: 2.5,
        idle: [3.0, 7.0], // Seconds between trains.
        warning: 1.1, // Signal lights before the train enters.
        halfDepth: .42,
    },
    eagle: {
        scrollSpeed: [.32, .60], // Camera pressure, cells/s (easy..hard); estimate.
        margin: 4.5, // Rows the player may fall behind the scrolling line.
        backLimit: 4, // Rows behind the best row before the eagle comes.
        swoopSeconds: .55, carrySeconds: .9,
    },
    death: {
        restartDelay: .8,
        flatY: .14, flatXZ: 1.35,
        sinkSeconds: .45,
    },
    hud: {font: "fonts/retro.ttf", fontSize: 32, x: 18, y: 14, topSize: 16, coinSize: 24,
        title: ["CHICKEN", "HOP"], titleSize: 48}, // Title screen lines (font: digits, A-Z, space).
    pools: {
        // Ground pools: one per slot. Row content: sized for a 36-row window.
        grass: 36, grass_alt: 36, grass_b: 36, grass_alt_b: 36, ripple: 36, road: 36, road_marked: 36,
        water: 36, rail: 36,
        tree: 225, tree_tall: 90, rock: 45,
        car_purple: 33, car_cyan: 33, car_orange: 33, truck: 40,
        log2: 36, log3: 36, log4: 30,
        train_loco: 9, train_wagon: 36, signal: 9, signal_light: 9,
        lily: 45, coin: 24,
    },
    budgets: {
        // M1 set 8,000 source triangles for a static scene; M4 is judged by frame
        // time first. Triangles stay reported against this provisional ceiling.
        sourceTriangles: 12000,
        reportedRamBytes: 20 * 1024 * 1024,
        vramBytes: 3.5 * 1024 * 1024,
        cpuP95Ms: 16.67,
    },
    particles: {
        counts: [36, 24, 12, 16, 6], // white, splash, gold, dust, red cube slots.
    },
    coin: {height: .42, spin: 3.2, bob: .06},
    multi: {
        startGap: 1, // Two players start at x = -1 and +1.
        maxGap: 12, // Rows the trailing player may be behind the other before the eagle comes.
        focusOffset: -1.2, // Camera focus ahead of each player in two-player views (solo: camera.targetOffset).
        maxDrift: 1.5, // Rows the scroll line may pull a two-player view ahead of its player.
        mergeEpsilon: .06, // Split views closer than this (cells) are drawn as one.
        divider: 3, // Divider line thickness, pixels.
        headHeight: .98, // A player hopping onto the other rides on its head, this high.
    },
    audio: {
        volume: 90, // Sound.setSfxVolume
        panWidth: 8, panMax: 70, // Cells from the camera centre to full pan; pan cap (of 100).
        near: 2, far: 9, // Rows: full volume within near, silent beyond far (trains, bells).
        gain: {hop: .55, land_log: .8, land_lily: .7, bell: .6},
        streamVolume: {title: 70, ambience: 55}, fadeMs: 700,
    },
    juice: {
        shakeSeconds: .35, shakeAmount: .22, // Camera shake on car/train hits.
        logDip: .07, dipSeconds: .25, // Log/lily pad sinks a little when landed on.
        lilyBob: .015, // Idle lily pad bobbing.
        breathe: .035, breatheRate: 5, // Idle chicken: vertical squash amount, rad/s.
        lookYaw: .55, lookRate: .9, // Title screen: the chicken looks around.
        rippleDrift: .35, rippleStill: .18, // Water streaks: share of the row speed; cells/s on still rows.
        panelFade: .3, // Game-over panel fade-in, seconds.
    },
    measurement: {cpuFrames: 600, maxEvents: 64},
};
