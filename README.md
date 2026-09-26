# Story Room

A portfolio you walk around in. Visitors land in a dark studio with only your 3D avatar
visible, scroll to watch you turn around and flip the light switch, then take control:
walk around the studio, look at the setup, and pick project frames off the wall to see
them full screen.

Built with [three.js](https://threejs.org) and [Vite](https://vitejs.dev). No framework,
no backend. It's a static site.

## Night Shift: the story

After the lights come on, **Bulb** (a lightbulb that gained consciousness when you hit the
switch) wakes up. It's 2 AM, the big pitch is at 7 AM, and the deck is blank. The studio
runs on **Sparks**: collect six and the deck builds itself. Every spark moves the clock
toward morning, and the window slowly turns from night to sunrise.

| Spark | Station | What you do |
|---|---|---|
| Body before brush | Treadmill (by the window) | Hold ↑ to run 100 m. The belt moves and the console tracks distance |
| Drop the needle | Turntable (cube shelf) | The character drops the needle; generated music plays, a disco ball descends, LEDs chase the beat |
| Sing to the neon | Karaoke stage | Rhythm game: hit Space as words reach the circle; the character sings in a robot voice. Rank S–C |
| Sketch the big idea | Worktable | Draw on a real canvas; it gets pinned to the 3D pinboard and stays there next visit |
| Brew the fuel | Espresso bar | Hold to pour, release in the gold zone. Reward: +40% run speed and caffeine jitters |
| Study your past lives | Gallery wall | Pick up three project frames |
| **Ship it** | Desk | Sit down; the computer opens **PitchOS**: about, work, contact, and a log of everything the visitor did tonight. Ship → confetti, sunrise |

**Secrets (5):** 10 dumbbell curls, a power nap on the sofa, watering the monstera
(it grows), the second light switch (party mode), and reading from the bookshelf.

Visitors who just want the portfolio can hit **Skip to portfolio** in the quest panel.
All story text, lyrics and PitchOS content live in `src/content.js`.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the production build
```

## Make it yours

Everything a visitor reads is in **`src/content.js`**:

- `profile`: the name, role and intro copy shown on the hero and on the monitors.
- `projects`: the frames on the gallery wall (title, one-line description, tag, colours).
  To use a real image, put it in `public/projects/` and set `image: 'projects/file.jpg'`.
  Without an image, a cover is generated from `palette`.

### Avatar and animations

| File | What it is |
|---|---|
| `public/models/avatar.glb` | Avaturn avatar, exported as **Avatar (T-Pose)** |
| `public/anims/idle.glb` | Standing idle (slimmed three.js sample, Mixamo rig) |
| `public/anims/walk.fbx`, `run.fbx`, `walk-back.fbx` | Mixamo locomotion |
| `public/anims/turn-180.fbx` | Intro: turning to face the switch |
| `public/anims/button-push.fbx` | Intro: pressing the switch |
| `public/anims/holding-idle.fbx` | Holding a frame while inspecting it |

Any Mixamo clip works: download **FBX Binary, Without Skin, 30 fps** and add it to the
`CLIPS` map in `src/main.js`. Clips are retargeted onto the avatar's skeleton when the
page loads (`src/character/retarget.js`), so a different Avaturn/Mixamo-rigged avatar can
replace `avatar.glb` without re-exporting animations.

## Controls

| | Desktop | Phone (landscape) |
|---|---|---|
| Intro | Scroll. Arrow keys / Space skip | Swipe up. Tap to skip |
| Move | Arrow keys / WASD | Left joystick |
| Run | Shift | Run button, or push the joystick to the edge |
| Look | Click, then move the mouse / trackpad (Esc releases) | Drag anywhere |
| Interact (stations, frames) | Space | Action button (label changes) |
| Leave a station | Esc / Q, or the Leave button | Leave button |

Walking backwards (↓ / S) backpedals while still facing forward. In portrait, phones are
asked to rotate before the game starts.

## How it's put together

```
src/
  main.js              renderer, bloom, loading, the intro → handover → play state machine
  content.js           your copy and projects
  audio.js             synthesised sound effects + a live music sequencer (3 tracks) and robot singer
  ui.js                DOM helpers: prompts, HUD, toasts, confetti
  character/
    avatar.js          animation blending, stride-locked foot sync, lean, head look, finger poses
    retarget.js        Mixamo → avatar retargeting (world-space delta from T-pose)
    ik.js              two-bone arm IK + hand aiming (switch press, gripping frames)
  game/
    stations.js        every interactive station + the shared walk-up/glide-in choreography
    story.js           sparks, secrets, clock, sunrise, quest panel, waypoint, night log
    companion.js       Bulb: the floating, talking lightbulb
    pitchos.js         the desk computer: portfolio + tonight's recap + ship button
    intro.js           scroll-scrubbed opening sequence and camera path
    player.js          movement, collision, third-person camera
    interact.js        pick up / inspect / hang back
    input.js           keyboard, pointer lock, touch joystick
  world/
    room.js            the studio, its lights, the power-on sequence, party mode, sunrise
    props.js           treadmill, stage, disco ball, espresso bar, dumbbells, spark comets
    kit.js             shared builders and materials
    screens.js         monitor/laptop displays that boot up
    textures.js        procedural wood, plaster, rugs, covers, scenery
scripts/slim-idle.mjs  strips a glTF to skeleton + chosen animations
assets-src/            original uploads not used at runtime
```

The room is procedural: no 3D files except the avatar. Static meshes are merged by
material at startup (about 230 draw calls). Phones get a lighter tier (lower pixel ratio,
fewer shadows). Append `?q=low` or `?q=high` to force a tier.

## Deploy

`npm run build` and upload `dist/` to any static host (Vercel, Netlify, Cloudflare Pages,
GitHub Pages). Asset paths are relative, so it also works from a sub-path.
