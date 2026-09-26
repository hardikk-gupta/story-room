// Strips a Mixamo-rig glTF down to its skeleton nodes + the animations we use.
// Usage: node scripts/slim-idle.mjs in.glb out.glb Idle TPose
import { NodeIO } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';

const [input, output, ...keep] = process.argv.slice(2);
const io = new NodeIO();
const doc = await io.read(input);
const root = doc.getRoot();
for (const a of root.listAnimations()) if (!keep.includes(a.getName())) a.dispose();
for (const n of root.listNodes()) {
  n.setMesh(null);
  n.setSkin(null);
}
for (const m of root.listMeshes()) m.dispose();
for (const s of root.listSkins()) s.dispose();
await doc.transform(prune({ keepLeaves: true }));
await io.write(output, doc);
console.log('animations kept:', root.listAnimations().map((a) => a.getName()));
