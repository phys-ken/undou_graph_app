'use strict';

const vm = require('node:vm');
const { createCanvas, Image, registerFont } = require('canvas');

function buildSandbox() {
  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Image,
    document: {
      createElement(tag) {
        const t = String(tag).toLowerCase();
        if (t === 'canvas') {
          const c = createCanvas(1, 1);
          // node-canvas's Canvas has no DOM .style; existing js/problems.js sets
          // canvas.style.width/height (CSS-only, no effect on pixels). Provide
          // a plain receiver so those assignments don't throw.
          if (!c.style) c.style = {};
          return c;
        }
        throw new Error(`document.createElement('${tag}') is not supported in API mode`);
      },
      addEventListener() {},
    },
    navigator: { userAgent: 'kinematics-problem-api/node' },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

module.exports = { buildSandbox, registerFont };
