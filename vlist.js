/**
 * The MIT License (MIT)
 *
 * Copyright (C) 2013, 2016 Sergi Mansilla
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the 'Software'), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

'use strict';

/*
 * Creates a virtually-rendered scrollable list.
 * @param {object} config
 * @constructor
 */
function VirtualList(config) {
  if (config.itemHeight) {
    this.itemHeight = config.itemHeight;
  } else {
    this.itemHeight = 0;    
  }
  this.pinFirstRow = config.pinFirstRow
  this.erd = elementResizeDetectorMaker();
  this.items = config.items;
  if ('totalRows' in config)
    this.totalRows = config.totalRows;
  else if (this.items)
    this.totalRows = this.items.length;

  this.generatorFn = config.generatorFn;
  this.destructorFn = config.destructorFn
  this.postBuildFxn = config.postBuildFxn
  
  var scroller = VirtualList.createScroller(this.itemHeight * this.totalRows);

  this._screenItemsLen = 0;
  this.container = document.createElement('div')
  this.innerContainer = VirtualList.createInnerContainer("100%", "100%");
  this.innerContainer.appendChild(scroller);
  this.container.appendChild(this.innerContainer)

  var self = this;
  self._lastRepaintY = 0;

  if (this.pinFirstRow && this.totalRows > 0)
  {
    this.firstRow = this.createRow(0)
    this.container.appendChild(this.firstRow)
  }

  this.rowsPossiblyChanged = function() {
    var oldRowCount = self.totalRows;

    if ('items' in this && this.items)
      self.totalRows = this.items.length;

    if (this.itemHeight == 0 && this.totalRows) {
      var row = this.createRow(0)
      self.innerContainer.appendChild(row);
      this.itemHeight = row.getBoundingClientRect().height;
      self.innerContainer.removeChild(row);
      if (this.itemHeight == 0)
        return;

      // Triggers update
      this.heightChanged();
      return;
    } else if (self.totalRows != oldRowCount && this.itemHeight) {
      this.heightChanged()
    } else if (self.totalRows && this.itemHeight && !this._screenItemsLen &&
        self.container.getBoundingClientRect().height > 0) {
      this.heightChanged();
    }
  }

  this.heightChanged = function() {
    var h = self.container.getBoundingClientRect().height
    self._screenItemsLen = Math.ceil(h / self.itemHeight);
    // Cache 4 times the number of items that fit in the innerContainer viewport
    self.cachedItemsLen = self._screenItemsLen * 3;
    self._maxBuffer = self._screenItemsLen *.66* self.itemHeight;

    scroller.style.height = self.itemHeight * self.totalRows + "px";
    if (self.firstRow) {
      self.firstRow.style.width = this.innerContainer.clientWidth + "px"

    }
    self.update();

  }

  if (config && config.h) {
    this.heightChanged();
  }

  function onScroll(e) {
    self.update();
    e && e.preventDefault && e.preventDefault();
  }

  this.erd.listenTo(this.innerContainer, function() {
    self.heightChanged();
  });

  this.innerContainer.addEventListener('scroll', onScroll);
}

VirtualList.prototype.getScrollPosition = function () {
  return this.innerContainer.scrollTop
}

VirtualList.prototype.ensureRowVisible = function(row) {
  var top = row * this.itemHeight;
  var bottom = top + this.itemHeight

  if (top < this.innerContainer.scrollTop)
    this.innerContainer.scrollTop = top
  else if (bottom > (this.innerContainer.scrollTop + this.innerContainer.clientHeight))
    this.innerContainer.scrollTop = top - this.innerContainer.clientHeight + this.itemHeight
}

VirtualList.prototype.setRowHeight = function(v) {
  if (v <= 0 || v == this.itemHeight) return;
  var topRow = this.getRowIndexAt(0);
  this.itemHeight = v;
  this.innerContainer.scrollTop = this.itemHeight * topRow;
  this.heightChanged();
}

VirtualList.prototype.getRowIndexAt = function(y) {
  var pos = y + this.innerContainer.scrollTop;
  var idx = Math.floor(pos / this.itemHeight);
  if (idx < this.totalRows)
    return idx;
  else
    return -1;
}

VirtualList.prototype.getRow = function(index) {
  if (index == 0 && this.pinFirstRow)
    return this.firstRow;

  var rowNodes = this.innerContainer.querySelectorAll(".vrow");
  for (var i = 0 ; i < rowNodes.length; ++i) {
    var rowIdx = parseInt(rowNodes[i].style.top)/this.itemHeight;
    if (rowIdx == index) {
      return rowNodes[i];
    }
  }

  return null;
}

VirtualList.prototype.createRow = function(i) {
  var item;
  if (this.generatorFn)
    item = this.generatorFn(i);
  else if (this.items) {
    if (typeof this.items[i] === 'string') {
      var itemText = document.createTextNode(this.items[i]);
      item = document.createElement('div');
      item.style.height = this.itemHeight + 'px';
      item.appendChild(itemText);
    } else {
      item = this.items[i];
    }
  }

  if (this.pinFirstRow && i == 0)
    this.firstRow = item;

  item.classList.add('vrow');
  item.style.position = 'absolute';
  item.style.top = (i * this.itemHeight) + 'px';
  return item;
};

/**
 * Renders a particular, consecutive chunk of the total rows in the list. To
 * keep acceleration while scrolling, we mark the nodes that are candidate for
 * deletion instead of deleting them right away, which would suddenly stop the
 * acceleration. We delete them once scrolling has finished.
 *
 * @param {Node} node Parent node where we want to append the children chunk.
 * @param {Number} from Starting position, i.e. first children index.
 * @return {void}
 */
VirtualList.prototype._renderChunk = function(node, from) {
  var finalItem = from + this.cachedItemsLen;
  if (finalItem > this.totalRows)
    finalItem = this.totalRows;

  // Append all the new rows in a document fragment that we will later append to
  // the parent node

  var fragment = document.createDocumentFragment();
  for (var i = from; i < finalItem; i++) {

    if (i == 0 && this.firstRow && this.pinFirstRow)
      continue;

    if ('curStartItem' in this)
    {
      if (i < this.curStartItem || i >= this.curStartItem + this.cachedItemsLen)
      {
        fragment.appendChild(this.createRow(i));
      }
    } else {
      fragment.appendChild(this.createRow(i));
    }
  }

  if ('curStartItem' in this) 
  {
    var lastStartItem = this.curStartItem
    // Trim any rows from the start
    for (var i = Math.max(lastStartItem, 0); i < from; ++i)
    {
      if (i == 0 && this.pinFirstRow)
        continue;

      var child = this.getRow(i);
      if (child) {
        child.style.display = 'none';
        child.setAttribute('data-rm', '1');
      }
    }

    var oldEnd = lastStartItem + this.cachedItemsLen
    for (var i = finalItem; i < oldEnd; ++i)
    {
      if (i == 0 && this.pinFirstRow)
        continue;
      var child = this.getRow(i);
      if (child) {
        child.style.display = 'none';
        child.setAttribute('data-rm', '1');
      }
    }
  }

  this.curStartItem = from;
  node.appendChild(fragment);
};

VirtualList.createInnerContainer = function(w, h) {
  var c = document.createElement('div');
  c.style.width = "100%";
  c.style.height = "100%";
  c.style.overflow = 'auto';
  c.style.position = 'relative';
  c.style.padding = 0;
  return c;
};


VirtualList.prototype.rebuild = function() {
  var rows = this.innerContainer.querySelectorAll('.vrow');
  for (var i = 0; i < rows.length; ++i) { 
    rows[i].style.display = 'none';
    rows[i].setAttribute('data-rm', 1);
  }
  delete this['curStartItem'];

  this.rowsPossiblyChanged();

  if (this.pinFirstRow)
  {
    if (this.firstRow) {
      this.firstRow.style.display = 'none'
      this.firstRow.parentElement.removeChild(this.firstRow);
      this.firstRow = null
    }

    if (this.totalRows > 0) {
      this.firstRow = this.createRow(0)
      this.container.appendChild(this.firstRow)
    }
  }

  this.update(true);
}

VirtualList.prototype.update = function(force) {
  if (force == null) {
    force = false;
  }

  // As soon as scrolling has stopped, this interval asynchronouslyremoves all
  // the nodes that are not used anymore
  var self = this;
  var deleteNodes = function() {
    if (self.deleteNodesTimer) {
      clearTimeout(self.deleteNodesTimer);
    }

    self.deleteNodesTimer = setTimeout((function(obj) {
      var _this = obj;
      return function() {
        var badNodes = _this.innerContainer.querySelectorAll('.vrow[data-rm="1"]');
        for (var i = 0, l = badNodes.length; i < l; i++) {
          if (_this.destructorFn) {
            _this.destructorFn(badNodes[i]);
          }
          if (badNodes[i].parentNode == _this.innerContainer)
            _this.innerContainer.removeChild(badNodes[i]);
        }
      }
    })(self), 100);
  }

  this.rowsPossiblyChanged();
  
  var scrollTop = this.innerContainer.scrollTop; // Triggers reflow
  if (force || !('curStartItem' in this) || Math.abs(scrollTop - self._lastRepaintY) > this._maxBuffer) {
    if (self.itemHeight > 0 && this._screenItemsLen) {
      var first = parseInt(scrollTop / self.itemHeight) - this._screenItemsLen;
      this._renderChunk(self.innerContainer, first < 0 ? 0 : first);
      self._lastRepaintY = scrollTop;
      if (this.postBuildFxn)
        this.postBuildFxn();
    }
  }

  deleteNodes();
}

VirtualList.createScroller = function(h) {
  var scroller = document.createElement('div');
  scroller.style.opacity = 0;
  scroller.style.position = 'absolute';
  scroller.style.top = 0;
  scroller.style.left = 0;
  scroller.style.width = '1px';
  scroller.style.height = h + 'px';
  return scroller;
};
