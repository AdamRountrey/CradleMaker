import assert from "node:assert/strict";

import { measureCenteredMeshInradius } from "../src/clearanceCertificate.js";

function getMeshLike(positions, triangles, numProp = 3) {
  const vertexCount = positions.length / 3;
  const vertProperties = new Float32Array(vertexCount * numProp);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    vertProperties[vertex * numProp] = positions[vertex * 3];
    vertProperties[vertex * numProp + 1] = positions[vertex * 3 + 1];
    vertProperties[vertex * numProp + 2] = positions[vertex * 3 + 2];
    for (let property = 3; property < numProp; property += 1) {
      vertProperties[vertex * numProp + property] = vertex + property / 10;
    }
  }

  return {
    numProp,
    vertProperties,
    triVerts: new Uint32Array(triangles),
    numVert: vertexCount,
    numTri: triangles.length / 3,
  };
}

function reverseWinding(triangles) {
  const reversed = [];
  for (let index = 0; index < triangles.length; index += 3) {
    reversed.push(triangles[index], triangles[index + 2], triangles[index + 1]);
  }
  return reversed;
}

function assertClose(actual, expected, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

const tetraScale = 1 / Math.sqrt(3);
const tetraPositions = [
  tetraScale, tetraScale, tetraScale,
  tetraScale, -tetraScale, -tetraScale,
  -tetraScale, tetraScale, -tetraScale,
  -tetraScale, -tetraScale, tetraScale,
];
const tetraTriangles = [
  0, 2, 1,
  0, 1, 3,
  0, 3, 2,
  1, 2, 3,
];
const tetraMesh = getMeshLike(tetraPositions, tetraTriangles);
const tetraInradius = measureCenteredMeshInradius(tetraMesh);
assertClose(tetraInradius, 1 / 3);
assertClose(1 / tetraInradius, 3);

const reversedTetraMesh = getMeshLike(tetraPositions, reverseWinding(tetraTriangles));
assertClose(measureCenteredMeshInradius(reversedTetraMesh), tetraInradius);

const octaPositions = [
  1, 0, 0,
  -1, 0, 0,
  0, 1, 0,
  0, -1, 0,
  0, 0, 1,
  0, 0, -1,
];
const octaTriangles = [
  0, 2, 4,
  2, 1, 4,
  1, 3, 4,
  3, 0, 4,
  2, 0, 5,
  1, 2, 5,
  3, 1, 5,
  0, 3, 5,
];
const octaMesh = getMeshLike(octaPositions, octaTriangles, 5);
const octaInradius = measureCenteredMeshInradius(octaMesh);
assertClose(octaInradius, 1 / Math.sqrt(3));
assertClose(1 / octaInradius, Math.sqrt(3));
assert.ok(Number.isFinite(octaInradius) && octaInradius > 0);

assert.throws(
  () => measureCenteredMeshInradius(null),
  /Manifold mesh object/
);
assert.throws(
  () => measureCenteredMeshInradius({ ...tetraMesh, numProp: 2 }),
  /numProp/
);
assert.throws(
  () => measureCenteredMeshInradius({ ...tetraMesh, vertProperties: [...tetraMesh.vertProperties, 0] }),
  /divisible/
);
assert.throws(
  () => measureCenteredMeshInradius({
    ...tetraMesh,
    vertProperties: tetraMesh.vertProperties.map((value, index) => index === 0 ? NaN : value),
  }),
  /non-finite position/
);
assert.throws(
  () => measureCenteredMeshInradius({ ...tetraMesh, triVerts: [0, 2, 99, ...tetraTriangles.slice(3)] }),
  /invalid vertex index/
);
assert.throws(
  () => measureCenteredMeshInradius({ ...tetraMesh, triVerts: [0, 0, 1, ...tetraTriangles.slice(3)] }),
  /degenerate/
);
assert.throws(
  () => measureCenteredMeshInradius({ ...octaMesh, triVerts: [0, 1, 2, ...octaTriangles.slice(3)] }),
  /positive distance from the origin/
);

console.log("centered mesh inradius tests passed");
