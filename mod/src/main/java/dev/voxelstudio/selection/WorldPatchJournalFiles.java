package dev.voxelstudio.selection;

import java.io.*;
import java.nio.*;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.*;
import com.sun.jna.platform.win32.*;
import com.sun.jna.ptr.IntByReference;

/** Disk-worker only. No world access, deletion, replacement or retry. Windows
 * reads use the actual native handle: regular disk file, one hard link, bounded
 * size, no reparse point; concurrent write/delete handles are not shared. */
final class WorldPatchJournalFiles {
    static void directory(Path directory)throws IOException{
        if(!directory.isAbsolute()||!directory.normalize().equals(directory))throw new IOException("Physical absolute journal path required");
        Path current=directory.getRoot();checkDirectory(current);
        for(var part:directory){current=current.resolve(part);checkDirectory(current);}
    }
    private static void checkDirectory(Path path)throws IOException{
        var a=Files.readAttributes(path,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);
        if(!a.isDirectory()||a.isSymbolicLink()||a.isOther()||!path.toRealPath().equals(path))throw new IOException("Journal directory redirected; preserved");
    }
    static byte[] read(Path file,int maximum)throws IOException{
        directory(file.getParent());var before=Files.readAttributes(file,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);
        if(!before.isRegularFile()||before.isSymbolicLink()||before.isOther()||before.size()<1||before.size()>maximum||!file.toRealPath().equals(file))throw new IOException("Journal member type/link/quota rejected");
        byte[] bytes;
        if(System.getProperty("os.name").startsWith("Windows"))bytes=Windows.read(file,maximum);
        else {
            try{if(((Number)Files.getAttribute(file,"unix:nlink",LinkOption.NOFOLLOW_LINKS)).longValue()!=1)throw new IOException("Journal hard link rejected");}
            catch(UnsupportedOperationException|IllegalArgumentException e){throw new IOException("Journal link count unavailable; no unsafe fallback",e);}
            try(var channel=FileChannel.open(file,StandardOpenOption.READ,LinkOption.NOFOLLOW_LINKS)){
                var buffer=ByteBuffer.allocate(Math.toIntExact(before.size()+1));while(buffer.hasRemaining()&&channel.read(buffer)>=0){}
                if(buffer.position()!=before.size())throw new IOException("Journal changed during handle read");bytes=Arrays.copyOf(buffer.array(),buffer.position());
            }
        }
        var after=Files.readAttributes(file,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);
        if(!after.isRegularFile()||after.isSymbolicLink()||after.isOther()||!Objects.equals(before.fileKey(),after.fileKey())||after.size()!=before.size()||bytes.length!=before.size()||!after.lastModifiedTime().equals(before.lastModifiedTime()))throw new IOException("Journal changed during read; preserved");
        directory(file.getParent());return bytes;
    }
    static void publish(Path file,byte[] bytes,int maximum)throws IOException{
        if(bytes.length<1||bytes.length>maximum)throw new IOException("Journal member byte quota exceeded");directory(file.getParent());
        // CREATE_NEW preserves a partial/unknown previous publication instead
        // of adopting or overwriting it. A failed write is never retried.
        try(var channel=FileChannel.open(file,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE,LinkOption.NOFOLLOW_LINKS)){
            var buffer=ByteBuffer.wrap(bytes);while(buffer.hasRemaining())channel.write(buffer);channel.force(true);
        }
        if(!Arrays.equals(bytes,read(file,maximum)))throw new IOException("Published journal bytes differ; preserved");
    }
    private static final class Windows {
        private record Info(long bytes,long writeTime,int links){}
        private static Info info(WinNT.HANDLE h,int maximum)throws IOException{
            var standard=new WinBase.FILE_STANDARD_INFO();var basic=new WinBase.FILE_BASIC_INFO();
            if(!Kernel32.INSTANCE.GetFileInformationByHandleEx(h,WinBase.FileStandardInfo,standard.getPointer(),new WinDef.DWORD(standard.size()))
                ||!Kernel32.INSTANCE.GetFileInformationByHandleEx(h,WinBase.FileBasicInfo,basic.getPointer(),new WinDef.DWORD(basic.size())))throw new IOException("Native journal file information unavailable");
            standard.read();basic.read();long size=standard.EndOfFile.getValue();
            if(Kernel32.INSTANCE.GetFileType(h)!=WinNT.FILE_TYPE_DISK||(basic.FileAttributes&(WinNT.FILE_ATTRIBUTE_REPARSE_POINT|WinNT.FILE_ATTRIBUTE_DIRECTORY))!=0||standard.NumberOfLinks!=1||size<1||size>maximum)throw new IOException("Native journal file type/link/quota rejected");
            return new Info(size,basic.LastWriteTime.getValue(),standard.NumberOfLinks);
        }
        static byte[] read(Path file,int maximum)throws IOException{
            var h=Kernel32.INSTANCE.CreateFile(file.toString(),WinNT.GENERIC_READ,WinNT.FILE_SHARE_READ,null,WinNT.OPEN_EXISTING,WinNT.FILE_FLAG_OPEN_REPARSE_POINT,null);
            if(h==null||WinBase.INVALID_HANDLE_VALUE.equals(h))throw new IOException("Journal handle unavailable; no read fallback");
            try{
                var before=info(h,maximum);var output=new ByteArrayOutputStream((int)before.bytes);var chunk=new byte[65536];
                while(output.size()<before.bytes){int wanted=(int)Math.min(chunk.length,before.bytes-output.size());var received=new IntByReference();
                    if(!Kernel32.INSTANCE.ReadFile(h,chunk,wanted,received,null)||received.getValue()<1||received.getValue()>wanted)throw new IOException("Journal handle read incomplete");
                    output.write(chunk,0,received.getValue());
                }
                if(!before.equals(info(h,maximum)))throw new IOException("Journal native handle changed during read");return output.toByteArray();
            }finally{if(!Kernel32.INSTANCE.CloseHandle(h))throw new IOException("Journal handle close failed");}
        }
    }
    private WorldPatchJournalFiles(){}
}
