// 将 BMP 图片写入到 FrameBuffer
// 示例：sudo bmp_to_framebuffer ./image.bmp /dev/fb0

#include <iostream>
#include <fstream>
#include <vector>
#include <cstdint>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/ioctl.h>
#include <linux/fb.h>
#include <unistd.h>
#include <cstring>

#pragma pack(push, 1)
struct BMPFileHeader {
    uint16_t type;      // 文件类型 "BM" (0x4D42)
    uint32_t size;      // 文件大小
    uint16_t reserved1; // 保留
    uint16_t reserved2; // 保留
    uint32_t offset;    // 像素数据偏移量
};

struct BMPInfoHeader {
    uint32_t size;          // 信息头大小
    int32_t  width;         // 宽度
    int32_t  height;        // 高度 (正数表示倒序，负数表示正序)
    uint16_t planes;        // 色彩平面数
    uint16_t bitCount;      // 位深度 (1, 4, 8, 16, 24, 32)
    uint32_t compression;   // 压缩类型 (0:BI_RGB, 1:BI_RLE8, 2:BI_RLE4, 3:BI_BITFIELDS)
    uint32_t sizeImage;     // 像素数据大小
    int32_t  xPelsPerMeter; // 水平分辨率
    int32_t  yPelsPerMeter; // 垂直分辨率
    uint32_t clrUsed;       // 使用的颜色数
    uint32_t clrImportant;  // 重要颜色数
};
#pragma pack(pop)

// 辅助结构：用于解析 BI_BITFIELDS 掩码
struct BitFieldInfo {
    uint32_t mask;
    int shift;
    int width;
};

// 计算掩码的移位和宽度
BitFieldInfo getBitFieldInfo(uint32_t mask) {
    BitFieldInfo info{};
    info.mask = mask;
    if (mask == 0) return info;
    
    // 计算右移位数
    info.shift = 0;
    uint32_t temp = mask;
    while ((temp & 1) == 0) {
        temp >>= 1;
        info.shift++;
    }
    
    // 计算位宽
    info.width = 0;
    while ((temp & 1) == 1) {
        temp >>= 1;
        info.width++;
    }
    return info;
}

// RLE8 解压函数
std::vector<uint8_t> decodeRLE8(const uint8_t* data, size_t dataSize, int width, int height) {
    std::vector<uint8_t> output(width * height, 0);
    int x = 0, y = 0;
    size_t pos = 0;

    while (pos < dataSize) {
        uint8_t count = data[pos++];
        if (count == 0) {
            uint8_t escape = data[pos++];
            if (escape == 0) { // 行结束
                x = 0;
                y++;
            } else if (escape == 1) { // 图像结束
                break;
            } else if (escape == 2) { // Delta 偏移
                x += data[pos++];
                y += data[pos++];
            } else { // 绝对模式
                for (int i = 0; i < escape; i++) {
                    if (x < width && y < height) {
                        output[y * width + x] = data[pos];
                        x++;
                    }
                    pos++;
                }
                if (escape % 2 != 0) pos++; // 2字节对齐
            }
        } else { // 编码模式
            uint8_t color = data[pos++];
            for (int i = 0; i < count; i++) {
                if (x < width && y < height) {
                    output[y * width + x] = color;
                    x++;
                }
            }
        }
    }
    return output;
}

// RLE4 解压函数
std::vector<uint8_t> decodeRLE4(const uint8_t* data, size_t dataSize, int width, int height) {
    std::vector<uint8_t> output(width * height, 0);
    int x = 0, y = 0;
    size_t pos = 0;

    while (pos < dataSize) {
        uint8_t count = data[pos++];
        if (count == 0) {
            uint8_t escape = data[pos++];
            if (escape == 0) { // 行结束
                x = 0;
                y++;
            } else if (escape == 1) { // 图像结束
                break;
            } else if (escape == 2) { // Delta 偏移
                x += data[pos++];
                y += data[pos++];
            } else { // 绝对模式
                bool highNibble = true;
                uint8_t byte = 0;
                for (int i = 0; i < escape; i++) {
                    if (highNibble) byte = data[pos++];
                    uint8_t idx = highNibble ? (byte >> 4) : (byte & 0x0F);
                    if (x < width && y < height) {
                        output[y * width + x] = idx;
                        x++;
                    }
                    highNibble = !highNibble;
                }
                // 对齐检查：如果读取的字节数是奇数，跳过填充
                if (((escape + 1) / 2) % 2 != 0) pos++;
            }
        } else { // 编码模式
            uint8_t byte = data[pos++];
            bool highNibble = true;
            for (int i = 0; i < count; i++) {
                uint8_t idx = highNibble ? (byte >> 4) : (byte & 0x0F);
                if (x < width && y < height) {
                    output[y * width + x] = idx;
                    x++;
                }
                highNibble = !highNibble;
            }
        }
    }
    return output;
}

int main(int argc, char* argv[]) {
    const char* filename = "image.bmp";
    const char* fbname = "/dev/fb0";
    if (argc > 1) filename = argv[1];
    if (argc > 2) fbname = argv[2];

    // 1. 打开 Framebuffer
    int fbfd = open(fbname, O_RDWR);
    if (fbfd == -1) { perror("打开 fb 失败"); return 1; }

    // 2. 获取屏幕信息
    struct fb_var_screeninfo vinfo;
    struct fb_fix_screeninfo finfo;
    ioctl(fbfd, FBIOGET_VSCREENINFO, &vinfo);
    ioctl(fbfd, FBIOGET_FSCREENINFO, &finfo);
    
    uint8_t* fbp = (uint8_t*)mmap(nullptr, finfo.smem_len, PROT_READ | PROT_WRITE, MAP_SHARED, fbfd, 0);
    if (fbp == MAP_FAILED) { perror("内存映射失败"); close(fbfd); return 1; }

    // 3. 读取 BMP 文件
    std::ifstream file(filename, std::ios::binary);
    if (!file) { std::cerr << "无法打开文件" << std::endl; munmap(fbp, finfo.smem_len); close(fbfd); return 1; }

    BMPFileHeader fileHeader;
    BMPInfoHeader infoHeader;
    file.read(reinterpret_cast<char*>(&fileHeader), sizeof(fileHeader));
    file.read(reinterpret_cast<char*>(&infoHeader), sizeof(infoHeader));

    if (fileHeader.type != 0x4D42) { std::cerr << "非 BMP 文件" << std::endl; return 1; }

    int imgWidth = infoHeader.width;
    int imgHeight = abs(infoHeader.height);
    bool isTopDown = (infoHeader.height < 0);

    // 4. 读取颜色表 (如果是索引色)
    std::vector<uint32_t> colorTable;
    if (infoHeader.bitCount <= 8) {
        int colorCount = infoHeader.clrUsed == 0 ? (1 << infoHeader.bitCount) : infoHeader.clrUsed;
        colorTable.resize(colorCount);
        file.read(reinterpret_cast<char*>(colorTable.data()), colorCount * 4);
    }

    // 5. 读取并解压像素数据
    std::vector<uint8_t> pixelData; // 存储解压后的索引或原始数据
    bool isIndexed = (infoHeader.bitCount <= 8);
    
    file.seekg(fileHeader.offset, std::ios::beg);
    std::vector<uint8_t> rawData(infoHeader.sizeImage);
    file.read(reinterpret_cast<char*>(rawData.data()), rawData.size());

    if (infoHeader.compression == 0) { // BI_RGB (无压缩)
        int rowSize = ((imgWidth * infoHeader.bitCount + 31) / 32) * 4;
        pixelData.resize(rowSize * imgHeight);
        file.seekg(fileHeader.offset, std::ios::beg);
        file.read(reinterpret_cast<char*>(pixelData.data()), pixelData.size());
    } 
    else if (infoHeader.compression == 1) { // BI_RLE8
        pixelData = decodeRLE8(rawData.data(), rawData.size(), imgWidth, imgHeight);
    } 
    else if (infoHeader.compression == 2) { // BI_RLE4
        pixelData = decodeRLE4(rawData.data(), rawData.size(), imgWidth, imgHeight);
    } 
    else {
        std::cerr << "不支持的压缩格式: " << infoHeader.compression << std::endl;
        return 1;
    }

    // 6. 绘制到 Framebuffer
    int drawW = std::min(imgWidth, (int)vinfo.xres);
    int drawH = std::min(imgHeight, (int)vinfo.yres);

    for (int y = 0; y < drawH; ++y) {
        // 处理 BMP 上下翻转
        int srcY = isTopDown ? y : (imgHeight - 1 - y);

        for (int x = 0; x < drawW; ++x) {
            uint8_t r, g, b, a = 255;

            if (isIndexed) {
                uint8_t idx = 0;
                // 从解压数据或无压缩数据中获取索引
                if (infoHeader.compression == 1 || infoHeader.compression == 2) {
                    idx = pixelData[srcY * imgWidth + x];
                } else {
                    int rowSize = ((imgWidth * infoHeader.bitCount + 31) / 32) * 4;
                    uint8_t* srcRow = pixelData.data() + srcY * rowSize;
                    if (infoHeader.bitCount == 8) {
                        idx = srcRow[x];
                    } else if (infoHeader.bitCount == 4) {
                        idx = (x % 2 == 0) ? (srcRow[x/2] >> 4) : (srcRow[x/2] & 0x0F);
                    }
                }
                // 从颜色表获取 RGB (BMP 颜色表格式为 BGRX)
                uint32_t color = colorTable[idx];
                b = color & 0xFF;
                g = (color >> 8) & 0xFF;
                r = (color >> 16) & 0xFF;
            } else {
                // 直接读取 RGB (24/32位)
                int rowSize = ((imgWidth * infoHeader.bitCount + 31) / 32) * 4;
                uint8_t* srcRow = pixelData.data() + srcY * rowSize;
                if (infoHeader.bitCount == 24) {
                    b = srcRow[x*3+0]; g = srcRow[x*3+1]; r = srcRow[x*3+2];
                } else if (infoHeader.bitCount == 32) {
                    b = srcRow[x*4+0]; g = srcRow[x*4+1]; r = srcRow[x*4+2]; a = srcRow[x*4+3];
                }
            }

            // 写入 Framebuffer (假设是 32位 BGRA 模式，这是最常见的)
            long fbIdx = (x + vinfo.xoffset) * (vinfo.bits_per_pixel/8) + 
                         (y + vinfo.yoffset) * finfo.line_length;
            
            if (vinfo.bits_per_pixel == 32) {
                fbp[fbIdx+0] = b;
                fbp[fbIdx+1] = g;
                fbp[fbIdx+2] = r;
                fbp[fbIdx+3] = a;
            } else if (vinfo.bits_per_pixel == 16) { // RGB565
                uint16_t c = ((r>>3)<<11) | ((g>>2)<<5) | (b>>3);
                *(uint16_t*)(&fbp[fbIdx]) = c;
            }
        }
    }

    // 清理
    munmap(fbp, finfo.smem_len);
    close(fbfd);
    std::cout << "显示完成" << std::endl;
    return 0;
}
