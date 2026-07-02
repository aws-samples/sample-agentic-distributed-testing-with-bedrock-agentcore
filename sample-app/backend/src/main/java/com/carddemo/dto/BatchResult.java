package com.carddemo.dto;

import java.util.List;

public record BatchResult(int processed, int rejected, List<String> rejections) {
}
