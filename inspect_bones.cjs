const fs = require('fs');
const path = require('path');

// Read the GLB file
const glbPath = path.join(__dirname, 'public/kelion-rpm_e27cb94d.glb');
const buffer = fs.readFileSync(glbPath);

// GLB format: 12-byte header, then chunks
// Header: magic(4) + version(4) + length(4)
const magic = buffer.readUInt32LE(0);
const version = buffer.readUInt32LE(4);
const totalLength = buffer.readUInt32LE(8);

console.log('GLB Magic:', magic.toString(16), 'Version:', version, 'Total Length:', totalLength);

// First chunk is JSON
const chunk0Length = buffer.readUInt32LE(12);
const chunk0Type = buffer.readUInt32LE(16);
const jsonStr = buffer.slice(20, 20 + chunk0Length).toString('utf8');
const gltf = JSON.parse(jsonStr);

// Find all nodes that are joints/bones
if (gltf.skins) {
  console.log('\n=== SKINS ===');
  gltf.skins.forEach((skin, i) => {
    console.log(`Skin ${i}: ${skin.name || 'unnamed'}, joints: ${skin.joints?.length}`);
    if (skin.joints) {
      skin.joints.forEach(jointIdx => {
        const node = gltf.nodes[jointIdx];
        console.log(`  Joint ${jointIdx}: ${node.name} rotation:${JSON.stringify(node.rotation)} translation:${JSON.stringify(node.translation)}`);
      });
    }
  });
}

// Also check for animations
if (gltf.animations && gltf.animations.length > 0) {
  console.log('\n=== ANIMATIONS ===');
  gltf.animations.forEach((anim, i) => {
    console.log(`Animation ${i}: ${anim.name || 'unnamed'}, channels: ${anim.channels?.length}`);
  });
} else {
  console.log('\nNo animations in the model.');
}

// List all node names
console.log('\n=== ALL NODES ===');
gltf.nodes.forEach((node, i) => {
  if (node.name && (node.name.includes('Arm') || node.name.includes('arm') || node.name.includes('Shoulder') || node.name.includes('shoulder') || node.name.includes('Spine') || node.name.includes('Hips'))) {
    console.log(`  Node ${i}: ${node.name} rot:${JSON.stringify(node.rotation)} trans:${JSON.stringify(node.translation)}`);
  }
});
