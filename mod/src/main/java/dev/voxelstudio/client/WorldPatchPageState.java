package dev.voxelstudio.client;

/** One in-flight operation across resize/re-entry. Closing invalidates UI
 * publication, not an already-dispatched model call or its durable history. */
final class WorldPatchPageState {
    private long generation,sequence,activeTicket,activeGeneration;
    private boolean live,busy;
    synchronized void enter(){live=true;generation++;}
    synchronized void leave(){live=false;generation++;}
    synchronized boolean live(){return live;}
    synchronized java.util.function.BooleanSupplier publication(){long ticket=generation;return ()->valid(ticket);}
    private synchronized boolean valid(long ticket){return live&&generation==ticket;}
    synchronized boolean available(){return live&&!busy;}
    synchronized long begin(){if(!available())return -1;busy=true;activeTicket=++sequence;activeGeneration=generation;return activeTicket;}
    synchronized boolean finish(long ticket){if(!busy||ticket!=activeTicket)return false;busy=false;return live&&activeGeneration==generation;}
}
