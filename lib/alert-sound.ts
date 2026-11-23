// Alarma de exceso de velocidad: tres subidas rápidas de tono, como una sirena de emergencia.
// Se sintetiza con Web Audio (sin archivos), así suena igual en el navegador y en la app Android.
export const ALARM_MS=1500;
const WHOOPS=3,WHOOP=.42,GAP=.1,LOW=620,HIGH=1380;

export function playAlarm(ctx:BaseAudioContext,destination:AudioNode=ctx.destination,start=ctx.currentTime){
  // Filtro para quitar lo chillón y compresor para que suene fuerte sin saturar.
  const filter=ctx.createBiquadFilter(),compressor=ctx.createDynamicsCompressor(),output=ctx.createGain();
  filter.type='lowpass';filter.frequency.value=3400;filter.Q.value=.7;
  compressor.threshold.value=-14;compressor.ratio.value=6;
  output.gain.value=1.6;
  filter.connect(compressor);compressor.connect(output);output.connect(destination);
  // Dos osciladores algo desafinados dan el timbre de sirena.
  const voices:[OscillatorType,number,number][]=[['sawtooth',0,.3],['square',9,.14]];
  let playing=0;
  for(let i=0;i<WHOOPS;i++){
    const t=start+i*(WHOOP+GAP);
    for(const [type,detune,level] of voices){
      const oscillator=ctx.createOscillator(),gain=ctx.createGain();
      oscillator.type=type;oscillator.detune.value=detune;
      oscillator.frequency.setValueAtTime(LOW,t);oscillator.frequency.exponentialRampToValueAtTime(HIGH,t+WHOOP*.9);
      gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(level,t+.03);
      gain.gain.setValueAtTime(level,t+WHOOP*.82);gain.gain.exponentialRampToValueAtTime(.001,t+WHOOP);
      oscillator.connect(gain);gain.connect(filter);
      oscillator.start(t);oscillator.stop(t+WHOOP+.02);
      playing++;
      oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();if(--playing===0){filter.disconnect();compressor.disconnect();output.disconnect()}};
    }
  }
}
