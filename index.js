//=[ CONSTANTS ]================================================================

const PRESETS = {
  RULES: {
    CONWAY: `// This is the body of a JS function.
// The following is available:
//   state(dx,dy): state of the neighbour at distance (dx,dy)

neighbors = [
  [-1,-1],[ 0,-1],[ 1,-1],
  [-1, 0],        [ 1, 0],
  [-1, 1],[ 0, 1],[ 1, 1],
]

score = neighbors.
  map(([x,y]) => state(x,y)).
  reduce((u,v) => u+v)

if      (score <  2) return 0
else if (score == 2) return state(0,0)
else if (score == 3) return 1
else if (score >  3) return 0
`,
    PARITY: `// This is the body of a JS function.
// The following is available:
//   state(dx,dy): state of the neighbour at distance (dx,dy)

neighbors = [
  [-1,-1],[ 0,-1],[ 1,-1],
  [-1, 0],        [ 1, 0],
  [-1, 1],[ 0, 1],[ 1, 1],
]

score = neighbors.
  map(([x,y]) => state(x,y)).
  reduce((u,v) => u+v)

return score % 2
`,
  },
  SEEDS: {
    RANDOM: `// This is the body of a JS function iterated on cells.
// The following is available:
//   x: current cell horizontal index
//   y: current cell vertical index
//   cols: world width
//   rows: world height

return Math.random() < 0.5 ? 0 : 1
`,
    SINGLETON: `// This is the body of a JS function iterated on cells.
// The following is available:
//   x: current cell horizontal index
//   y: current cell vertical index
//   cols: world width
//   rows: world height

is_center = x == Math.floor(cols/2) 
is_middle = y == Math.floor(rows/2)
return is_center && is_middle ? 1 : 0
`,
  },
  EDGES: {
    WRAP: `// This is the body of a JS function applied to cells.
// The following is available:
//   x: current cell horizontal index
//   y: current cell vertical index
//   cols: world width
//   rows: world height
//   state(x,y): state of the cell at position (x,y)

xx = (cols + x) % cols
yy = (rows + y) % rows
return state[xx][yy]
`,
    WALL: `// This is the body of a JS function applied to cells.
// The following is available:
//   x: current cell horizontal index
//   y: current cell vertical index
//   cols: world width
//   rows: world height
//   state(x,y): state of the cell at position (x,y)

if (x < 0 || x >= cols) return 0
if (y < 0 || y >= rows) return 0
return state[x][y]
`,
  },
};

const SELECTORS = {
  SIMULATION: "#simulation",
  BUTTON: ".interactor",
  BUTTONS: {
    RESTART: "#restart",
    CONWAY: "#rule_conway",
    PARITY: "#rule_parity",
    RANDOM: "#seed_random",
    SINGLETON: "#seed_singleton",
    WRAP: "#edge_wrap",
    WALL: "#edge_wall",
  },
  EDITORS: {
    RULE: "#rule_editor",
    SEED: "#seed_editor",
    EDGE: "#edge_editor",
  },
};

const EDITORS_DEFAULT_CONFIG = {
  mode: "javascript",
  theme: "monokai",
  autoRefresh: true,
};

//=[ Engine ]===================================================================

class GOL {
  constructor({ cols = 512, rows = 512, fps = 16 } = {}) {
    this.cols = cols;
    this.rows = rows;
    this.fps = fps;
    this.currState = Array.from(Array(this.cols), () => new Array(this.rows));
    this.nextState = Array.from(Array(this.cols), () => new Array(this.rows));

    this.initEditors();
    this.bindButtons();

    this.resetSimulation();

    this.initP5();
  }

  //-[ UX ]---------------------------------------------------------------------

  initEditors() {
    this.ruleEditor = CodeMirror(
      document.querySelector(SELECTORS.EDITORS.RULE),
      { ...EDITORS_DEFAULT_CONFIG, value: PRESETS.RULES.CONWAY }
    );

    this.seedEditor = CodeMirror(
      document.querySelector(SELECTORS.EDITORS.SEED),
      { ...EDITORS_DEFAULT_CONFIG, value: PRESETS.SEEDS.RANDOM }
    );

    this.edgeEditor = CodeMirror(
      document.querySelector(SELECTORS.EDITORS.EDGE),
      { ...EDITORS_DEFAULT_CONFIG, value: PRESETS.EDGES.WRAP }
    );
  }

  bindButtons() {
    document.addEventListener(
      "click",
      (event) => {
        if (!event.target.matches(SELECTORS.BUTTON)) return;
        if (event.target.matches(SELECTORS.BUTTONS.RESTART))
          this.resetSimulation();
        if (event.target.matches(SELECTORS.BUTTONS.CONWAY))
          this.ruleEditor.setValue(PRESETS.RULES.CONWAY);
        if (event.target.matches(SELECTORS.BUTTONS.PARITY))
          this.ruleEditor.setValue(PRESETS.RULES.PARITY);
        if (event.target.matches(SELECTORS.BUTTONS.RANDOM))
          this.seedEditor.setValue(PRESETS.SEEDS.RANDOM);
        if (event.target.matches(SELECTORS.BUTTONS.SINGLETON))
          this.seedEditor.setValue(PRESETS.SEEDS.SINGLETON);
        if (event.target.matches(SELECTORS.BUTTONS.WRAP))
          this.edgeEditor.setValue(PRESETS.EDGES.WRAP);
        if (event.target.matches(SELECTORS.BUTTONS.WALL))
          this.edgeEditor.setValue(PRESETS.EDGES.WALL);
        event.preventDefault();
      },
      false
    );
  }

  //-[ P5 ]---------------------------------------------------------------------

  initP5() {
    let sketch = (p) => {
      let black = p.color(0);
      let white = p.color(255);

      p.setup = () => {
        p.pixelDensity(1); // useful on retina screens
        p.createCanvas(this.cols, this.rows);
        p.frameRate(this.fps);
      };

      p.draw = () => {
        this.tick();

        for (let x = 0; x < this.cols; x++) {
          for (let y = 0; y < this.rows; y++) {
            p.set(x, y, this.currState[x][y] ? black : white);
          }
        }

        p.updatePixels();
      };
    };

    let container = document.querySelector(SELECTORS.SIMULATION);

    this.p5Instance = new p5(sketch, container);
  }

  //-[ Simulation ]-------------------------------------------------------------

  resetSimulation() {
    this.readFunctions();
    this.seed();
  }

  readFunctions() {
    this.ruleFunction = new Function("state", this.ruleEditor.getValue());
    this.seedFunction = new Function(
      "x",
      "y",
      "cols",
      "rows",
      this.seedEditor.getValue()
    );
    this.edgeFunction = new Function(
      "x",
      "y",
      "cols",
      "rows",
      "state",
      this.edgeEditor.getValue()
    );
  }

  seed() {
    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        this.currState[x][y] = this.seedFunction(x, y, this.cols, this.rows);
      }
    }
  }

  tick() {
    this.step();
    this.flip();
  }

  step() {
    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        this.nextState[x][y] = this.ruleFunction((dx, dy) =>
          this.edgeFunction(
            x + dx,
            y + dy,
            this.cols,
            this.rows,
            this.currState
          )
        );
      }
    }
  }

  flip() {
    let temp = this.currState;
    this.currState = this.nextState;
    this.nextState = temp;
  }
}

//=[ Instantiation ]============================================================

document.addEventListener("DOMContentLoaded", function () {
  window.gol = new GOL();
});
