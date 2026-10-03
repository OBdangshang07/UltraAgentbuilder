package dev.voxelstudio.client;
import java.util.Objects;
/** Bounded display only. Joining all pages preserves every original UTF-16
 * code unit exactly once, including surrogate pairs at nominal boundaries. */
final class WorldPatchPromptPages {
    static final int LIMIT=10000;
    static int count(String text){Objects.requireNonNull(text);return text.isEmpty()?1:(text.length()-1)/LIMIT+1;}
    private static int boundary(String text,int offset){if(offset>0&&offset<text.length()&&Character.isHighSurrogate(text.charAt(offset-1))&&Character.isLowSurrogate(text.charAt(offset)))return offset-1;return offset;}
    static String at(String text,int page){if(page<0||page>=count(text))throw new IllegalArgumentException("原文页范围无效");int start=boundary(text,page*LIMIT),end=boundary(text,(int)Math.min(text.length(),((long)page+1)*LIMIT));return text.substring(start,end);}
    private WorldPatchPromptPages(){}
}
