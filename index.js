//=[ CONSTANTS ]================================================================


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

class KOK {
  constructor({ cols = 512, rows = 512, fps = 16 } = {}) {
    this.backToCenter();
    this.initP5();
  }

  //-[ P5 ]---------------------------------------------------------------------

  isOutOfBounds () {
    return Math.abs(this.spider.x - 250) > 250 || Math.abs(this.spider.y - 250) > 250
  }

  backToCenter () {
    this.spider = { x : 250 , y : 250 , a : 2 * Math.PI * Math.random() }
  }

  initP5() {
    let sketch = (p) => {
      let black = p.color(0);
      let white = p.color(255);

      p.setup = () => {
        p.pixelDensity(1); // useful on retina screens
        p.createCanvas(500, 500);
        p.frameRate(30);
      };

      p.draw = () => {
        // this.tick();
        p.line(10, 10, 50, 50);

        let r = Math.random() * 30
        let da = (2 * Math.random() - 1) * Math.PI / 12
        let target = {
          x : this.spider.x + r * Math.cos(this.spider.a + da),
          y : this.spider.y + r * Math.sin(this.spider.a + da),
          a : this.spider.a + da
        }
        p.line(this.spider.x, this.spider.y, target.x, target.y);
        // for (let x = 0; x < this.cols; x++) {
        //   for (let y = 0; y < this.rows; y++) {
        //     p.set(x, y, this.currState[x][y] ? black : white);
        //   }
        // }
        this.spider = target
        if (this.isOutOfBounds()) this.backToCenter()

        p.updatePixels();
      };
    };

    let container = document.querySelector(SELECTORS.SIMULATION);

    this.p5Instance = new p5(sketch, container);
  }
}

//=[ Instantiation ]============================================================

document.addEventListener("DOMContentLoaded", function () {
  window.kok = new KOK();
});
