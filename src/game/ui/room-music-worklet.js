const targetRate = 24000;
const packetSize = 3600;

function muLaw(sample) {
  const pcm = Math.round(Math.max(-1, Math.min(1, sample)) * 32768);
  const magnitude = Math.min(Math.abs(pcm), 32635) + 132;
  // Integer log2 minus seven selects the G.711 segment (zero through seven).
  const segment = 24 - Math.clz32(magnitude);
  const mantissa = (magnitude >> (segment + 3)) & 15;
  return ~((pcm < 0 ? 128 : 0) | (segment << 4) | mantissa) & 255;
}

class RoomMusicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.packet = null;
    this.port.onmessage = ({ data }) => {
      this.generation = data.generation;
      this.packet = data.active ? new Uint8Array(packetSize) : null;
      this.offset = 0;
      this.remaining = sampleRate;
      this.sum = 0;
    };
  }

  process(inputs) {
    const mono = inputs[0]?.[0]; // Web Audio downmixes the capture branch to one channel.
    if (!this.packet || !mono) return true;
    // Integrate each input sample over the fraction of an output sample it
    // occupies. Integer rate units keep 44.1 kHz and 48 kHz streams drift-free.
    for (let i = 0; i < mono.length; i++) {
      let span = targetRate;
      while (span > 0) {
        const weight = Math.min(span, this.remaining);
        this.sum += mono[i] * weight;
        this.remaining -= weight;
        span -= weight;
        if (this.remaining === 0) {
          this.packet[this.offset++] = muLaw(this.sum / sampleRate);
          this.sum = 0;
          this.remaining = sampleRate;
          if (this.offset === packetSize) {
            const bytes = this.packet.buffer;
            this.port.postMessage({ generation: this.generation, bytes, endTime: currentTime + (i + 1) / sampleRate }, [bytes]);
            this.packet = new Uint8Array(packetSize);
            this.offset = 0;
          }
        }
      }
    }
    return true;
  }
}

registerProcessor('hex-room-music', RoomMusicProcessor);
