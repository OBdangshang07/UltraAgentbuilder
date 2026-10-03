package dev.voxelstudio.client;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.text.Text;
import java.util.Map;

final class StudioHud {
    static void render(DrawContext draw,Map<String,KeyBinding> keys) {
        var c=MinecraftClient.getInstance();var p=StudioClient.PROJECTION;
        if(c.currentScreen!=null||(!p.visible&&!p.busy))return;
        int w=Math.min(448,c.getWindow().getScaledWidth()-16);
        String hints=p.busy?key(keys,"open")+" 面板中可停止当前操作":key(keys,"lock")+" 锁定/跟随  ·  "+key(keys,"rotate")+" 旋转  ·  "+key(keys,"mirror")+" 镜像  ·  "+key(keys,"confirm")+" 确认  ·  "+key(keys,"open")+" 面板";
        String movement=key(keys,"west")+"/"+key(keys,"east")+" X  ·  "+key(keys,"north")+"/"+key(keys,"south")+" Z  ·  "+key(keys,"up")+"/"+key(keys,"down")+" Y  ·  Ctrl ×8  ·  "+key(keys,"hide")+" 隐藏";
        var lines=c.textRenderer.wrapLines(Text.literal(hints+(p.busy?"":"\n"+movement+"\n滚轮："+(p.locked?p.axisLabel()+"微调":"推远 / 拉近 · 距离 "+Math.round(p.followDistance)+" 格")+" · "+key(keys,"snap")+" 贴准星表面\n"+p.layerLabel()+" · H 退出后恢复物品栏滚轮")),w-18);
        int h=51+lines.size()*12;draw.fill(8,8,8+w,8+h,0xd9101d28);draw.fill(8,8,11,8+h,StudioTheme.ACCENT);
        draw.drawText(c.textRenderer,"体素投影 · "+(p.busy?"正在修改世界":p.locked?"锁定微调":"视线距离跟随"),17,15,StudioTheme.ACCENT,false);
        String position=p.anchor.toShortString()+"  ·  "+p.rotation*90+"°"+(p.mirror?"  ·  镜像":"");
        draw.drawText(c.textRenderer,StudioTheme.fit(c.textRenderer,position,w-18),17,28,StudioTheme.TEXT,false);
        String status=p.renderer.building?"正在准备建筑网格…":p.renderer.error!=null?"网格加载失败，打开面板查看详情":p.status;
        draw.drawText(c.textRenderer,StudioTheme.fit(c.textRenderer,status,w-18),17,40,p.renderer.error==null?StudioTheme.MUTED:StudioTheme.ERROR,false);
        int y=54;for(var line:lines){draw.drawText(c.textRenderer,line,17,y,StudioTheme.WARN,false);y+=12;}
        if(p.visible&&!p.busy&&!p.checked()){draw.fill(11,8+h-2,8+w,8+h,StudioTheme.BORDER);draw.fill(11,8+h-2,11+(int)((w-3)*p.checkProgress()),8+h,StudioTheme.ACCENT);}
    }
    private static String key(Map<String,KeyBinding> keys,String id){return keys.get(id).getBoundKeyLocalizedText().getString();}
}
