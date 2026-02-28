// gridscan.js — Adapted GridScan background effect (vanilla JS, from ReactBits)
// Uses Three.js for WebGL shader rendering

(function () {
    const canvas = document.getElementById('gridScanCanvas');
    if (!canvas || typeof THREE === 'undefined') return;

    const container = document.body;

    const vert = `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

    const frag = `
    precision highp float;
    uniform vec3 iResolution;
    uniform float iTime;
    uniform vec2 uSkew;
    uniform float uLineThickness;
    uniform vec3 uLinesColor;
    uniform vec3 uScanColor;
    uniform float uGridScale;
    uniform float uScanOpacity;
    uniform float uNoise;
    uniform float uBloomOpacity;
    uniform float uScanGlow;
    uniform float uScanSoftness;
    uniform float uPhaseTaper;
    uniform float uScanDuration;
    uniform float uScanDelay;
    varying vec2 vUv;

    float smoother01(float a, float b, float x){
      float t = clamp((x - a) / max(1e-5, (b - a)), 0.0, 1.0);
      return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
    }

    void mainImage(out vec4 fragColor, in vec2 fragCoord){
      vec2 p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
      vec3 ro = vec3(0.0);
      vec3 rd = normalize(vec3(p, 2.0));
      vec2 skew = clamp(uSkew, vec2(-0.7), vec2(0.7));
      rd.xy += skew * rd.z;

      vec3 color = vec3(0.0);
      float minT = 1e20;
      float gridScale = max(1e-5, uGridScale);
      float fadeStrength = 2.0;
      vec2 gridUV = vec2(0.0);
      float hitIsY = 1.0;

      for(int i = 0; i < 4; i++){
        float isY = float(i < 2);
        float pos = mix(-0.2, 0.2, float(i)) * isY + mix(-0.5, 0.5, float(i - 2)) * (1.0 - isY);
        float num = pos - (isY * ro.y + (1.0 - isY) * ro.x);
        float den = isY * rd.y + (1.0 - isY) * rd.x;
        float t = num / den;
        vec3 h = ro + rd * t;
        float depthBoost = smoothstep(0.0, 3.0, h.z);
        h.xy += skew * 0.15 * depthBoost;
        bool use = t > 0.0 && t < minT;
        gridUV = use ? mix(h.zy, h.xz, isY) / gridScale : gridUV;
        minT = use ? t : minT;
        hitIsY = use ? isY : hitIsY;
      }

      vec3 hit = ro + rd * minT;
      float dist = length(hit - ro);

      float fx = fract(gridUV.x);
      float fy = fract(gridUV.y);
      float ax = min(fx, 1.0 - fx);
      float ay = min(fy, 1.0 - fy);
      float wx = fwidth(gridUV.x);
      float wy = fwidth(gridUV.y);
      float halfPx = max(0.0, uLineThickness) * 0.5;
      float tx = halfPx * wx;
      float ty = halfPx * wy;
      float lineX = 1.0 - smoothstep(tx, tx + wx, ax);
      float lineY = 1.0 - smoothstep(ty, ty + wy, ay);
      float lineMask = max(lineX, lineY);

      float fade = exp(-dist * fadeStrength);

      float dur = max(0.05, uScanDuration);
      float del = max(0.0, uScanDelay);
      float scanZMax = 2.0;
      float widthScale = max(0.1, uScanGlow);
      float sigma = max(0.001, 0.18 * widthScale * uScanSoftness);
      float sigmaA = sigma * 2.0;

      float cycle = dur + del;
      float tCycle = mod(iTime, cycle);
      float scanPhase = clamp((tCycle - del) / dur, 0.0, 1.0);
      float phase = scanPhase;
      float t2 = mod(max(0.0, iTime - del), 2.0 * dur);
      phase = (t2 < dur) ? (t2 / dur) : (1.0 - (t2 - dur) / dur);

      float scanZ = phase * scanZMax;
      float dz = abs(hit.z - scanZ);
      float lineBand = exp(-0.5 * (dz * dz) / (sigma * sigma));
      float taper = clamp(uPhaseTaper, 0.0, 0.49);
      float headFade = smoother01(0.0, taper, phase);
      float tailFade = 1.0 - smoother01(1.0 - taper, 1.0, phase);
      float phaseWindow = headFade * tailFade;
      float combinedPulse = lineBand * phaseWindow * clamp(uScanOpacity, 0.0, 1.0);
      float auraBand = exp(-0.5 * (dz * dz) / (sigmaA * sigmaA));
      float combinedAura = (auraBand * 0.25) * phaseWindow * clamp(uScanOpacity, 0.0, 1.0);

      float lineVis = lineMask;
      vec3 gridCol = uLinesColor * lineVis * fade;
      vec3 scanCol = uScanColor * combinedPulse;
      vec3 scanAura = uScanColor * combinedAura;
      color = gridCol + scanCol + scanAura;

      float n = fract(sin(dot(gl_FragCoord.xy + vec2(iTime * 123.4), vec2(12.9898,78.233))) * 43758.5453123);
      color += (n - 0.5) * uNoise;
      color = clamp(color, 0.0, 1.0);

      float alpha = clamp(max(lineVis, combinedPulse), 0.0, 1.0);
      float gx = 1.0 - smoothstep(tx * 2.0, tx * 2.0 + wx * 2.0, ax);
      float gy = 1.0 - smoothstep(ty * 2.0, ty * 2.0 + wy * 2.0, ay);
      float halo = max(gx, gy) * fade;
      alpha = max(alpha, halo * clamp(uBloomOpacity, 0.0, 1.0));
      fragColor = vec4(color, alpha);
    }

    void main(){
      vec4 c;
      mainImage(c, vUv * iResolution.xy);
      gl_FragColor = c;
    }
  `;

    // Configuration
    const config = {
        lineThickness: 1,
        linesColor: '#392e4e',
        scanColor: '#FF9FFC',
        scanOpacity: 0.4,
        gridScale: 0.1,
        noiseIntensity: 0.01,
        bloomIntensity: 0.6,
        scanGlow: 0.5,
        scanSoftness: 2,
        scanPhaseTaper: 0.9,
        scanDuration: 2.0,
        scanDelay: 2.0
    };

    function srgbColor(hex) {
        const c = new THREE.Color(hex);
        c.convertSRGBToLinear();
        return c;
    }

    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);

    const uniforms = {
        iResolution: { value: new THREE.Vector3(window.innerWidth, window.innerHeight, renderer.getPixelRatio()) },
        iTime: { value: 0 },
        uSkew: { value: new THREE.Vector2(0, 0) },
        uLineThickness: { value: config.lineThickness },
        uLinesColor: { value: srgbColor(config.linesColor) },
        uScanColor: { value: srgbColor(config.scanColor) },
        uGridScale: { value: config.gridScale },
        uScanOpacity: { value: config.scanOpacity },
        uNoise: { value: config.noiseIntensity },
        uBloomOpacity: { value: config.bloomIntensity },
        uScanGlow: { value: config.scanGlow },
        uScanSoftness: { value: config.scanSoftness },
        uPhaseTaper: { value: config.scanPhaseTaper },
        uScanDuration: { value: config.scanDuration },
        uScanDelay: { value: config.scanDelay }
    };

    const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        depthTest: false
    });

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad);

    // Mouse tracking for parallax effect
    const skewScale = 0.12;
    const yBoost = 1.3;
    const target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };

    document.addEventListener('mousemove', (e) => {
        target.x = (e.clientX / window.innerWidth) * 2 - 1;
        target.y = -((e.clientY / window.innerHeight) * 2 - 1);
    });

    document.addEventListener('mouseleave', () => {
        target.x = 0;
        target.y = 0;
    });

    // Resize handler
    window.addEventListener('resize', () => {
        renderer.setSize(window.innerWidth, window.innerHeight);
        uniforms.iResolution.value.set(window.innerWidth, window.innerHeight, renderer.getPixelRatio());
    });

    // Animation loop
    function tick() {
        const smoothing = 0.05;
        current.x += (target.x - current.x) * smoothing;
        current.y += (target.y - current.y) * smoothing;

        uniforms.uSkew.value.set(
            current.x * skewScale,
            -current.y * yBoost * skewScale
        );
        uniforms.iTime.value = performance.now() / 1000;

        renderer.clear(true, true, true);
        renderer.render(scene, camera);
        requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
})();
