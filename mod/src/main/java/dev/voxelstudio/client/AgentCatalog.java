package dev.voxelstudio.client;

import com.google.gson.*;
import java.util.*;

/** UI-safe discovery state; ambiguous availability never chooses a provider. */
final class AgentCatalog {
    static final List<String> IDS=List.of("codex","claude","deepseek");
    record Status(boolean available,String state) {}
    private final Map<String,Status> entries=new HashMap<>();
    void accept(JsonArray agents){for(var value:agents){var a=value.getAsJsonObject();String id=a.get("id").getAsString();if(!IDS.contains(id))continue;entries.put(id,new Status(a.has("available")&&a.get("available").getAsBoolean(),a.has("state")?a.get("state").getAsString():"unavailable"));}}
    Status status(String id){return entries.getOrDefault(id,new Status(false,"not-checked"));}
    int available(){return (int)entries.values().stream().filter(Status::available).count();}
    String onlyAvailable(){return available()==1?IDS.stream().filter(id->status(id).available()).findFirst().orElse(null):null;}
    String label(String id){return switch(status(id).state()){
        case "ready"->"可用";case "configured"->"已配置（授权未验证）";case "login-required"->"需要登录";case "credential-required"->"需要配置凭据";
        case "not-found"->"未找到 CLI";case "unsupported"->"版本不支持";case "detecting"->"检测中";case "timeout"->"检测超时";case "not-checked"->"尚未检测";default->"需要检查配置";
    };}
}
