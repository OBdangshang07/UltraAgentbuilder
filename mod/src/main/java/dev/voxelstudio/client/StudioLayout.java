package dev.voxelstudio.client;

/** GUI-scaled coordinates, not physical pixels. Kept independent of the renderer for tests. */
public record StudioLayout(Rect sidebar, Rect content, Rect preview, Rect viewport, Rect footer) {
    public record Rect(int x, int y, int width, int height) {
        public int right() { return x + width; }
        public int bottom() { return y + height; }
        public boolean contains(double px, double py) { return px >= x && px < right() && py >= y && py < bottom(); }
    }
    public static StudioLayout of(int width, int height) {
        int margin=8, gap=8, top=43, bottom=height-39;
        int left=Math.min(300,Math.max(142,(width-24)*43/100));
        Rect sidebar=new Rect(margin,top,left,Math.max(60,bottom-top));
        Rect content=new Rect(margin+9,top+34,left-22,Math.max(24,bottom-top-76));
        Rect preview=new Rect(sidebar.right()+gap,top,Math.max(80,width-sidebar.right()-gap-margin),sidebar.height());
        Rect viewport=new Rect(preview.x()+1,top+31,preview.width()-2,Math.max(16,preview.height()-92));
        return new StudioLayout(sidebar,content,preview,viewport,new Rect(margin,height-32,width-margin*2,25));
    }
    public static int maxScroll(int contentHeight,int viewportHeight) { return Math.max(0,contentHeight-viewportHeight); }
    public static int clampScroll(int scroll,int contentHeight,int viewportHeight) { return Math.max(0,Math.min(scroll,maxScroll(contentHeight,viewportHeight))); }
    public static int coordinate(String text) {
        if(text==null || !text.matches("-?\\d{1,10}")) throw new IllegalArgumentException("坐标必须是整数");
        try { return Integer.parseInt(text); } catch(NumberFormatException e) { throw new IllegalArgumentException("坐标超出整数范围"); }
    }
}
