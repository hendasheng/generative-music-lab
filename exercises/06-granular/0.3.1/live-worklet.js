// Capture only: the output remains silent; grains are the only audible path.
class GrainCapture extends AudioWorkletProcessor {
  constructor(){super();this.chunk=new Float32Array(2048);this.used=0;}
  process(inputs){
    const channels=inputs[0];
    if(channels && channels.length)for(let i=0;i<channels[0].length;i++){
      let value=0;for(const channel of channels)value+=channel[i];
      this.chunk[this.used++]=value/channels.length;
      if(this.used===this.chunk.length){this.port.postMessage(this.chunk,[this.chunk.buffer]);this.chunk=new Float32Array(2048);this.used=0;}
    }
    return true;
  }
}
registerProcessor('grain-capture',GrainCapture);
