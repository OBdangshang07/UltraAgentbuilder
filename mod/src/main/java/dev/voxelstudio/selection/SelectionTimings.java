package dev.voxelstudio.selection;

import java.util.Arrays;

/** Bounded read-step timing samples; finalize only on the worker after ownership
 * transfer. These are NOT client frames or the whole server tick. */
public final class SelectionTimings {
    public record Result(long steps,int sampledSteps,boolean complete,double meanMillis,double p95Millis,double p99Millis,double maxMillis) {}
    private final long[] samples;private long steps,total,max;private int count;
    public SelectionTimings(){this(8192);}
    SelectionTimings(int size){if(size<1||size>8192)throw new IllegalArgumentException("Invalid timing sample quota");samples=new long[size];}
    public void record(long nanos){if(nanos<0)throw new IllegalArgumentException("Negative duration");steps++;total=Math.addExact(total,nanos);max=Math.max(max,nanos);if(count<samples.length)samples[count++]=nanos;}
    public Result finish(){var sorted=Arrays.copyOf(samples,count);Arrays.sort(sorted);return new Result(steps,count,steps==count,steps==0?0:total/(double)steps/1e6,percentile(sorted,.95)/1e6,percentile(sorted,.99)/1e6,max/1e6);}
    private long percentile(long[] values,double p){return values.length==0?0:values[Math.max(0,(int)Math.ceil(values.length*p)-1)];}
}
