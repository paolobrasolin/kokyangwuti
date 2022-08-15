//=[ CONSTANTS ]================================================================

const RADIAL_COUNT = 2 * 16

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
    this.spider = { x : 250 , y : 250 , a : 0 , radLines : 0 };
    this.initP5();
    this.phase = "radial"
  }

  //-[ P5 ]---------------------------------------------------------------------

  isOutOfBounds () {
    return Math.abs(this.spider.x - 250) > 250 || Math.abs(this.spider.y - 250) > 250
  }

  backToCenter () {
    this.spider.x = 250
    this.spider.y = 250
  }

  drawSpiral (p) {
    let dr = 0.75 * this.spider.a
    let da = (10 / 180 * Math.PI)
    let target = {
      x : this.spider.x + dr * Math.cos(this.spider.a + da),
      y : this.spider.y + dr * Math.sin(this.spider.a + da),
      a : this.spider.a + da
    }
    p.line(this.spider.x, this.spider.y, target.x, target.y);
    this.spider.x = target.x
    this.spider.y = target.y
    this.spider.a = target.a
    if (this.isOutOfBounds()) {
      this.backToCenter()
      this.phase = "stop"
    }
  }

  drawRadial (p) {
    let r = Math.random() * 30
    let da = (2 * Math.random() - 1) * Math.PI / 60
    let target = {
      x : this.spider.x + r * Math.cos(this.spider.a + da),
      y : this.spider.y + r * Math.sin(this.spider.a + da),
      a : this.spider.a + da
    }
    p.line(this.spider.x, this.spider.y, target.x, target.y);
    this.spider.x = target.x
    this.spider.y = target.y
    this.spider.a = target.a
    if (this.isOutOfBounds()) {
      this.backToCenter()
      this.spider.radLines += 1
      this.spider.a = (2 * Math.PI / RADIAL_COUNT) * this.spider.radLines
      if (this.spider.radLines > RADIAL_COUNT - 1) this.phase = "spiral"
    }
  }

  initP5() {
    let sketch = (p) => {
      let black = p.color(0);
      let white = p.color(255);

      p.setup = () => {
        p.pixelDensity(1); // useful on retina screens
        p.createCanvas(500, 500);
        p.frameRate(120);
      };

      p.draw = () => {
        // p.strokeWeight(5);
        // radial lines
        if (this.phase === "radial") this.drawRadial(p)
        // spiral
        if (this.phase === "spiral") this.drawSpiral(p)
        if (this.phase === "stop") {
          p.loadPixels();
          console.log(1 - p.pixels.filter((x, i) => x === 0 && i % 4 === 3).length / (500 * 500))
        }
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
